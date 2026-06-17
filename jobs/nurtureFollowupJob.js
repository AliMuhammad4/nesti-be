import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import ChatConversation from '../models/ChatConversation.js';
import NurtureLog from '../models/NurtureLog.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import User from '../models/User.js';
import { PROFESSIONAL_TYPE, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import sendEmail from '../utils/sendEmail.js';
import logger from '../utils/logger.js';
import { recordLeadKpiEvent } from '../services/analytics/leadKpiService.js';
import {
  FEATURES,
  SUBSCRIPTION_PLAN,
  getEffectivePlan,
  hasFeature,
} from '../services/billing/entitlements.js';
import { getOrCreateSubscriptionForUser } from '../services/billing/subscriptionService.js';
import { assertWithinPlanQuota, PlanQuotaError } from '../services/billing/planQuota.js';
import { withNestiNurtureCalendlyTracking } from '../services/nurture/nurtureCalendlyTracking.js';
import { loadPropertyMatchesForNurtureEmail } from '../services/nurture/nurturePropertyMatchesContext.js';
import { buildLeadContext, generateDraft } from '../services/nurture/nurtureEmailOpenAi.js';
import {
  composeNurtureEmailHtml,
  prepareNurturePlainBodyForEmail,
} from '../services/nurture/nurtureEmailTemplate.js';

const AUTOMATION_TYPE = 'fifteen_day_followup';
const TERMINAL_STATUSES = new Set(['converted', 'closed_lost']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;

function asInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function startOfUtcDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function maxDate(...values) {
  return values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function recipientEmail(profile, leadMatch) {
  const identity = profile?.identity || {};
  const contact = leadMatch?.compatibility_factors?.contact || {};
  return String(identity.email || identity.canonical_email || contact.email || '').trim();
}

function recipientName(profile, leadMatch) {
  const identity = profile?.identity || {};
  const contact = leadMatch?.compatibility_factors?.contact || {};
  return String(identity.full_name || contact.name || '').trim();
}

function professionalName(user, professionalProfile) {
  return (
    String(professionalProfile?.full_name || '').trim() ||
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
    'Your Nesti professional'
  );
}

function normalizeProfessionalType(raw) {
  const role = String(raw || '').trim().toLowerCase();
  if (role === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  if (role === PROFESSIONAL_TYPE.AGENT) return PROFESSIONAL_TYPE.AGENT;
  return PROFESSIONAL_TYPE.AGENT;
}

function roleSpecificNurtureGoal(profType) {
  if (profType === PROFESSIONAL_TYPE.LAWYER) {
    return 'Follow up on their transaction progress, invite them to schedule a legal consultation, and include a concise meeting-preparation checklist with documents to bring and closing-related questions.';
  }
  if (profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return 'Follow up on their financing timeline, invite them to schedule a mortgage review, and include a concise meeting-preparation checklist with income, tax, and banking documents to bring.';
  }
  return 'Send a professional follow-up to re-engage this client, invite them to schedule next steps, and include a concise meeting-preparation checklist with documents and priorities to bring to the meeting.';
}

function roleSpecificNurtureTone(profType) {
  if (profType === PROFESSIONAL_TYPE.LAWYER) return 'formal, reassuring, attorney-office professional';
  if (profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return 'clear, confident, financing-focused professional';
  return 'executive, warm, concise, brokerage-grade professional';
}

function buildSimpleFollowupEmail({ user, professionalProfile, profile, leadMatch }) {
  const name = recipientName(profile, leadMatch) || 'there';
  const senderName = professionalName(user, professionalProfile);
  const calendlyUrl = String(professionalProfile?.calendly_link || '').trim();
  const subject = `Checking in from ${senderName}`;
  const textParts = [
    `Hi ${name},`,
    `I wanted to quickly follow up and see if you had any questions or updates since we last connected.`,
    `If you are still exploring options, reply to this email and I will be happy to help with the next step.`,
  ];
  if (calendlyUrl) {
    textParts.push(`You can also book a time that works for you here: ${calendlyUrl}`);
  }
  textParts.push(`Best regards,\n${senderName}`);
  const message = textParts.join('\n\n');
  const htmlMessage = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <p>Hi ${escapeHtml(name)},</p>
      <p>I wanted to quickly follow up and see if you had any questions or updates since we last connected.</p>
      <p>If you are still exploring options, reply to this email and I will be happy to help with the next step.</p>
      ${
        calendlyUrl
          ? `<p><a href="${escapeHtml(calendlyUrl)}" style="display:inline-block;background:#34C759;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600">Book a time</a></p>`
          : ''
      }
      <p>Best regards,<br/>${escapeHtml(senderName)}</p>
    </div>
  `;

  return { subject, message, htmlMessage };
}

async function buildFollowupEmail({ user, professionalProfile, profile, leadMatch, conversation }) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return buildSimpleFollowupEmail({ user, professionalProfile, profile, leadMatch });
    }

    const profType = normalizeProfessionalType(
      leadMatch?.compatibility_factors?.professional_type || user?.role,
    );
    const includePropertyCards = profType === PROFESSIONAL_TYPE.AGENT;
    const signature = {
      display_name: professionalName(user, professionalProfile),
      email: user?.email ? String(user.email).trim() : null,
      phone: professionalProfile?.phone ? String(professionalProfile.phone).trim() : null,
    };
    const calendlyRaw = String(professionalProfile?.calendly_link || '').trim();
    const calendlyUrl = withNestiNurtureCalendlyTracking(calendlyRaw, {
      conversationId: leadMatch?.conversation_id || null,
      ownerUserId: user?._id || null,
    });
    const propertyMatches = includePropertyCards
      ? await loadPropertyMatchesForNurtureEmail({
          userId: user?._id,
          conversationId: leadMatch?.conversation_id,
          leadProfessionalType: profType,
          professionalProfile,
          leadProfile: profile || null,
          leadMatch: leadMatch || null,
          enableProfileFallback: true,
        })
      : { listings: [], context: null, note: null };
    const leadContext = buildLeadContext(leadMatch, profile, conversation, {
      property_matches: propertyMatches,
      viewer_professional_role: user?.role || null,
    });
    const draft = await generateDraft(leadContext, {
      goal: roleSpecificNurtureGoal(profType),
      tone: roleSpecificNurtureTone(profType),
    });
    const plainMessage = prepareNurturePlainBodyForEmail({
      bodyPlain: draft.body_text,
      listings: propertyMatches.listings || [],
      includePropertyCards,
      propertyMatchesContext: propertyMatches.context || null,
    });
    const htmlMessage = composeNurtureEmailHtml({
      bodyPlain: draft.body_text,
      listings: propertyMatches.listings || [],
      includePropertyCards,
      agentName: signature.display_name || 'Your Nesti professional',
      propertyMatchesContext: propertyMatches.context || null,
      propertyMatchesNote: propertyMatches.note || null,
      schedulingUrl: calendlyUrl || null,
      signature,
      listingTableColumns: 'score_notes',
    });
    const subject = String(draft.subject || '').trim();
    if (!subject || !plainMessage || !htmlMessage) {
      return buildSimpleFollowupEmail({ user, professionalProfile, profile, leadMatch });
    }
    return { subject, message: plainMessage, htmlMessage };
  } catch (err) {
    logger.warn('automated nurture draft/template fallback to simple email', {
      lead_match_id: String(leadMatch?._id || ''),
      error: err?.message,
    });
    return buildSimpleFollowupEmail({ user, professionalProfile, profile, leadMatch });
  }
}

async function userCanReceiveAutomatedFollowups(user) {
  const subscription = await getOrCreateSubscriptionForUser(user);
  if (!hasFeature(subscription, FEATURES.LEADS_FOLLOWUP_AUTOMATED)) {
    return false;
  }
  return getEffectivePlan(subscription) === SUBSCRIPTION_PLAN.ENTERPRISE;
}

async function latestNurtureLogForLead(leadMatch) {
  return NurtureLog.findOne({
    lead_match_id: leadMatch._id,
    status: 'sent',
  })
    .sort({ sent_at: -1, createdAt: -1 })
    .select('sent_at createdAt automation_type')
    .lean();
}

async function sendFollowupForLead(leadMatch, now, followupDays) {
  const [user, profile, professionalProfile, latestLog, conversation] = await Promise.all([
    User.findById(leadMatch.user_id).select('_id first_name last_name email role is_verified createdAt').lean(),
    leadMatch.lead_profile_id ? LeadProfile.findById(leadMatch.lead_profile_id).lean() : null,
    ProfessionalProfile.findOne({ user_id: leadMatch.user_id }).lean(),
    latestNurtureLogForLead(leadMatch),
    leadMatch.conversation_id ? ChatConversation.findById(leadMatch.conversation_id).lean() : null,
  ]);

  if (!user || !user.is_verified || !PROFESSIONAL_TYPE_VALUES.includes(user.role)) {
    return { sent: false, skipped: 'invalid_user' };
  }
  if (!(await userCanReceiveAutomatedFollowups(user))) {
    return { sent: false, skipped: 'feature_unavailable' };
  }

  try {
    const subscription = await getOrCreateSubscriptionForUser(user);
    await assertWithinPlanQuota({
      userId: user._id,
      subscription,
      limitKey: 'followup_actions',
    });
  } catch (err) {
    if (err instanceof PlanQuotaError) {
      const { notifyPlanLimitReachedIfNeeded } = await import('../services/billing/planLimitNotifications.js');
      await notifyPlanLimitReachedIfNeeded(user._id, err);
      return { sent: false, skipped: 'quota_reached' };
    }
    throw err;
  }

  const lastTouch = maxDate(latestLog?.sent_at, latestLog?.createdAt, leadMatch.last_contact_at, leadMatch.createdAt);
  if (!lastTouch || now.getTime() - lastTouch.getTime() < followupDays * MS_PER_DAY) {
    return { sent: false, skipped: 'not_due' };
  }

  const recipient = recipientEmail(profile, leadMatch);
  if (!recipient) {
    return { sent: false, skipped: 'missing_email' };
  }

  const idempotencyKey = `${AUTOMATION_TYPE}:${String(leadMatch._id)}:${dateKey(lastTouch)}`;
  const alreadySent = await NurtureLog.exists({
    idempotency_key: idempotencyKey,
    status: 'sent',
  });
  if (alreadySent) {
    return { sent: false, skipped: 'already_sent' };
  }

  const failedToday = await NurtureLog.exists({
    idempotency_key: idempotencyKey,
    status: 'failed',
    createdAt: { $gte: startOfUtcDay(now) },
  });
  if (failedToday) {
    return { sent: false, skipped: 'failed_today' };
  }

  const email = await buildFollowupEmail({
    user,
    professionalProfile,
    profile,
    leadMatch,
    conversation,
  });
  const result = await sendEmail({
    email: recipient,
    subject: email.subject,
    message: email.message,
    htmlMessage: email.htmlMessage,
  });

  const status = result.success ? 'sent' : 'failed';
  await NurtureLog.create({
    user_id: user._id,
    lead_match_id: leadMatch._id,
    lead_profile_id: leadMatch.lead_profile_id || null,
    conversation_id: leadMatch.conversation_id || null,
    to_email: recipient,
    subject: email.subject,
    body: email.message,
    status,
    automation_type: AUTOMATION_TYPE,
    idempotency_key: idempotencyKey,
    followup_due_for: lastTouch,
  });

  if (!result.success) {
    return { sent: false, skipped: 'send_failed' };
  }

  await Promise.all([
    LeadMatch.updateOne(
      { _id: leadMatch._id },
      {
        $set: { last_contact_at: now, match_status: leadMatch.match_status === 'new' ? 'nurturing' : leadMatch.match_status },
        $inc: { contact_count: 1 },
      },
    ),
    recordLeadKpiEvent({
      user_id: user._id,
      lead_match_id: leadMatch._id,
      conversation_id: leadMatch.conversation_id || null,
      event_type: 'nurture_email_sent',
      grade: String(leadMatch.lead_type || '').split('_')[0] || null,
      metadata: { automated: true, automation_type: AUTOMATION_TYPE },
    }).catch((err) => {
      logger.warn('automated nurture KPI event failed', { error: err?.message });
    }),
  ]);

  return { sent: true };
}

export async function runFifteenDayNurtureFollowups(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const followupDays = asInt(process.env.NURTURE_FOLLOWUP_DAYS, 15, { min: 1, max: 365 });
  const batchLimit = asInt(process.env.NURTURE_FOLLOWUP_BATCH_LIMIT, 50, { min: 1, max: 500 });
  const dueBefore = new Date(now.getTime() - followupDays * MS_PER_DAY);

  const candidates = await LeadMatch.find({
    match_status: { $nin: [...TERMINAL_STATUSES] },
    $or: [
      { last_contact_at: { $lte: dueBefore } },
      { last_contact_at: { $exists: false }, createdAt: { $lte: dueBefore } },
      { last_contact_at: null, createdAt: { $lte: dueBefore } },
    ],
  })
    .sort({ last_contact_at: 1, createdAt: 1 })
    .limit(batchLimit)
    .lean();

  const stats = { checked: candidates.length, sent: 0, skipped: {}, failed: 0 };
  for (const leadMatch of candidates) {
    try {
      const result = await sendFollowupForLead(leadMatch, now, followupDays);
      if (result.sent) {
        stats.sent += 1;
      } else {
        const key = result.skipped || 'unknown';
        stats.skipped[key] = (stats.skipped[key] || 0) + 1;
      }
    } catch (err) {
      stats.failed += 1;
      logger.warn('automated nurture follow-up failed for lead', {
        lead_match_id: String(leadMatch?._id || ''),
        error: err?.message,
      });
    }
  }

  logger.info('15-day nurture follow-up job completed', stats);
  return stats;
}

function nextDailyDelayMs(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(6, 15, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(60_000, next.getTime() - now.getTime());
}

function scheduleSafeTimeout(callback, delayMs) {
  return setTimeout(callback, Math.min(Math.max(Number(delayMs) || 0, 1), MAX_SAFE_TIMEOUT_MS));
}

let scheduled = false;

export function scheduleNurtureFollowupJob() {
  if (scheduled) return;
  if (process.env.ENABLE_NURTURE_FOLLOWUP_JOB === 'false') return;
  scheduled = true;

  const run = () => {
    runFifteenDayNurtureFollowups().catch((err) => {
      logger.warn('runFifteenDayNurtureFollowups failed', { error: err?.message });
    });
  };

  const scheduleNextRun = () => {
    scheduleSafeTimeout(async () => {
      await runFifteenDayNurtureFollowups().catch((err) => {
        logger.warn('scheduled nurture follow-up failed', { error: err?.message });
      });
      scheduleNextRun();
    }, nextDailyDelayMs());
  };

  const initialDelay = asInt(process.env.NURTURE_FOLLOWUP_INITIAL_DELAY_MS, 120_000, {
    min: 10_000,
    max: MAX_SAFE_TIMEOUT_MS,
  });
  scheduleSafeTimeout(run, initialDelay);
  scheduleNextRun();
}
