import mongoose from 'mongoose';
import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import ChatConversation from '../models/ChatConversation.js';
import NurtureLog from '../models/NurtureLog.js';
import { PROFESSIONAL_TYPE } from '../constants/roles.js';
import { resolveMortgageCalendlyUrl } from '../services/chat/mortgageBroker/mortgageCalendlyUtils.js';
import sendEmail from '../utils/sendEmail.js';
import logger from '../utils/logger.js';
import { parsePageLimitPagination, buildPaginationMeta, PAGINATION_PRESETS } from '../utils/pagination.js';
import { recordLeadKpiEvent } from '../services/analytics/leadKpiService.js';
import {
  buildLeadContext,
  finalizeNurtureDraftBody,
  generateDraft,
  refineDraft,
} from '../services/nurture/nurtureEmailOpenAi.js';
import { loadPropertyMatchesForNurtureEmail } from '../services/nurture/nurturePropertyMatchesContext.js';
import { composeNurtureEmailHtml } from '../services/nurture/nurtureEmailTemplate.js';

async function loadLeadBundle(userId, leadMatchId) {
  if (!mongoose.Types.ObjectId.isValid(leadMatchId)) return null;
  const leadMatch = await LeadMatch.findOne({ _id: leadMatchId, user_id: userId }).lean();
  if (!leadMatch) return null;
  const profile = leadMatch.lead_profile_id
    ? await LeadProfile.findById(leadMatch.lead_profile_id).lean()
    : null;
  const conversation = leadMatch.conversation_id
    ? await ChatConversation.findById(leadMatch.conversation_id)
        .select(
          'intent calendly_booking_status lead_grade lead_classification lead_score lead_reasons is_qualified emotional_state',
        )
        .lean()
    : null;
  return { leadMatch, profile, conversation };
}

/**
 * Resolve nurture bundle by LeadMatch id or by LeadProfile id (latest match for this professional).
 */
async function loadLeadBundleForNurture(userId, { lead_match_id, lead_profile_id }) {
  if (lead_match_id && mongoose.Types.ObjectId.isValid(String(lead_match_id))) {
    return loadLeadBundle(userId, lead_match_id);
  }
  if (lead_profile_id && mongoose.Types.ObjectId.isValid(String(lead_profile_id))) {
    const leadMatch = await LeadMatch.findOne({
      user_id:         userId,
      lead_profile_id: new mongoose.Types.ObjectId(lead_profile_id),
    })
      .sort({ last_contact_at: -1, updatedAt: -1, createdAt: -1 })
      .lean();
    if (!leadMatch) return null;
    return loadLeadBundle(userId, String(leadMatch._id));
  }
  return null;
}

function nurtureLeadIdsResponse(bundle) {
  const lm = bundle?.leadMatch;
  return {
    lead_match_id: lm?._id ? String(lm._id) : null,
    lead_profile_id: lm?.lead_profile_id ? String(lm.lead_profile_id) : null,
  };
}

const PRO_NURTURE_SELECT =
  'professional_type full_name phone calendly_link mortgage_calendly_link_hot mortgage_calendly_link_warm mortgage_calendly_link_early';

function resolveProfessionalCalendlyUrl(professionalProfile, leadMatch) {
  if (!professionalProfile) return '';
  const flowRole =
    leadMatch?.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const grade = String(leadMatch?.lead_type || '').split('_')[0] || null;
  if (flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return resolveMortgageCalendlyUrl(professionalProfile, grade);
  }
  return String(professionalProfile.calendly_link || '').trim();
}

function buildNurtureSignature(professionalProfile, user) {
  const display_name =
    String(professionalProfile?.full_name || '').trim() ||
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
    '';
  const email = user?.email != null && String(user.email).trim() ? String(user.email).trim() : '';
  const phone =
    professionalProfile?.phone != null && String(professionalProfile.phone).trim()
      ? String(professionalProfile.phone).trim()
      : '';
  return { display_name, email: email || null, phone: phone || null };
}

/** Remove server-appended plain-text footer before sending back to the model on refine. */
function stripServerAppendedNurturePlainFooter(text, calendlyUrl, signature) {
  let t = String(text || '').trim();
  if (calendlyUrl) {
    const needle = 'Book a time that works for you:';
    const i = t.lastIndexOf(needle);
    if (i !== -1 && t.slice(i).includes(calendlyUrl)) {
      t = t.slice(0, i).trim();
    }
  }
  if (signature?.display_name) {
    const br = t.lastIndexOf('\n\nBest regards,');
    if (br !== -1) {
      const tail = t.slice(br + 2);
      if (tail.includes(signature.display_name) && (!signature.email || tail.includes(signature.email))) {
        t = t.slice(0, br).trim();
      }
    }
  }
  return t;
}

async function loadProfessionalNurtureMeta(userId, leadMatch, user) {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId })
    .select(PRO_NURTURE_SELECT)
    .lean();
  const calendly_url = resolveProfessionalCalendlyUrl(professionalProfile, leadMatch);
  const signature = buildNurtureSignature(professionalProfile, user);
  return { calendly_url, signature, professionalProfile };
}

function openAiUnavailable(res) {
  return res.status(503).json({ success: false, message: 'OpenAI is not configured' });
}

function isRecoverableAiError(err) {
  return err.message === 'AI returned invalid JSON' || err.message.includes('Missing');
}

function handleNurtureAiException(err, res, next, logPrefix) {
  logger.error(`${logPrefix} error`, { error: err.message });
  if (isRecoverableAiError(err)) {
    return res.status(502).json({ success: false, message: err.message || `${logPrefix} failed` });
  }
  return next(err);
}

function resolveConversationId(bodyConversationId, leadMatch) {
  if (bodyConversationId && mongoose.Types.ObjectId.isValid(bodyConversationId)) {
    return new mongoose.Types.ObjectId(bodyConversationId);
  }
  return leadMatch.conversation_id || null;
}

function nurtureLogPayload({ userId, leadMatch, convId, recipient, subject, body, status }) {
  return {
    user_id: userId,
    lead_match_id: leadMatch._id,
    conversation_id: convId,
    to_email: recipient,
    subject,
    body,
    status,
  };
}

function trimEmail(value) {
  const t = value != null ? String(value).trim() : '';
  return t || null;
}

/**
 * Prefer LeadProfile identity (email, then canonical_email), then chat contact on LeadMatch,
 * then optional body to_email only when nothing is stored on the lead.
 */
function resolveRecipientEmail(to_email, bundle) {
  const id = bundle.profile?.identity;
  const fromProfile = trimEmail(id?.email) || trimEmail(id?.canonical_email);
  const fromMatchContact = trimEmail(bundle.leadMatch?.compatibility_factors?.contact?.email);
  const fromBody = trimEmail(to_email);
  return fromProfile || fromMatchContact || fromBody || null;
}

/** Draft/refine API responses expose plain text only; send may still accept optional body_html. */
function nurtureDraftJsonResponse(draft) {
  return { subject: draft.subject, body_text: draft.body_text };
}

async function nurturePropertyMatchesSnapshot(userId, leadMatch, professionalProfile) {
  return loadPropertyMatchesForNurtureEmail({
    userId,
    conversationId: leadMatch?.conversation_id,
    leadProfessionalType: leadMatch?.compatibility_factors?.professional_type,
    professionalProfile,
  });
}

export async function postNurtureDraft(req, res, next) {
  try {
    if (!process.env.OPENAI_API_KEY) return openAiUnavailable(res);
    const { lead_match_id, lead_profile_id, goal, tone } = req.body;
    const bundle = await loadLeadBundleForNurture(req.user._id, {
      lead_match_id,
      lead_profile_id,
    });
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message:
          'Lead not found. Use lead_match_id, or lead_profile_id with a LeadMatch linked to your account.',
      });
    }

    const { calendly_url, signature, professionalProfile } = await loadProfessionalNurtureMeta(
      req.user._id,
      bundle.leadMatch,
      req.user,
    );
    const propertyMatches = await nurturePropertyMatchesSnapshot(
      req.user._id,
      bundle.leadMatch,
      professionalProfile,
    );
    const leadContext = buildLeadContext(bundle.leadMatch, bundle.profile, bundle.conversation, {
      property_matches: propertyMatches,
    });
    const draftRaw = await generateDraft(leadContext, {
      goal,
      tone,
    });
    const draft = finalizeNurtureDraftBody(draftRaw, { calendly_url, signature });
    return res.json({
      success: true,
      ...nurtureLeadIdsResponse(bundle),
      calendly_url: calendly_url || null,
      draft: nurtureDraftJsonResponse(draft),
    });
  } catch (err) {
    return handleNurtureAiException(err, res, next, 'nurture draft');
  }
}

export async function postNurtureRefine(req, res, next) {
  try {
    if (!process.env.OPENAI_API_KEY) return openAiUnavailable(res);
    const { lead_match_id, lead_profile_id, subject, body, instruction } = req.body;
    const bundle = await loadLeadBundleForNurture(req.user._id, {
      lead_match_id,
      lead_profile_id,
    });
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message:
          'Lead not found. Use lead_match_id, or lead_profile_id with a LeadMatch linked to your account.',
      });
    }

    const { calendly_url, signature, professionalProfile } = await loadProfessionalNurtureMeta(
      req.user._id,
      bundle.leadMatch,
      req.user,
    );
    const bodyForAi = stripServerAppendedNurturePlainFooter(body, calendly_url, signature);
    const propertyMatches = await nurturePropertyMatchesSnapshot(
      req.user._id,
      bundle.leadMatch,
      professionalProfile,
    );
    const leadContext = buildLeadContext(bundle.leadMatch, bundle.profile, bundle.conversation, {
      property_matches: propertyMatches,
    });
    const draftRaw = await refineDraft(leadContext, { subject, body_text: bodyForAi }, instruction);
    const draft = finalizeNurtureDraftBody(draftRaw, { calendly_url, signature });
    return res.json({
      success: true,
      ...nurtureLeadIdsResponse(bundle),
      calendly_url: calendly_url || null,
      draft: nurtureDraftJsonResponse(draft),
    });
  } catch (err) {
    return handleNurtureAiException(err, res, next, 'nurture refine');
  }
}

export async function postNurtureSend(req, res, next) {
  try {
    const {
      lead_match_id,
      lead_profile_id,
      conversation_id,
      to_email,
      subject,
      body,
      body_html,
      include_property_cards,
    } = req.body;
    const bundle = await loadLeadBundleForNurture(req.user._id, {
      lead_match_id,
      lead_profile_id,
    });
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message:
          'Lead not found. Use lead_match_id, or lead_profile_id with a LeadMatch linked to your account.',
      });
    }

    const recipient = resolveRecipientEmail(to_email, bundle);
    if (!recipient) {
      return res.status(400).json({
        success: false,
        message:
          'No recipient email for this lead. Set identity.email (or canonical_email) on the LeadProfile, or pass to_email when the profile has no address.',
      });
    }

    const convId = resolveConversationId(conversation_id, bundle.leadMatch);
    const customHtml = body_html != null && String(body_html).trim();
    let htmlForSend;
    if (customHtml) {
      htmlForSend = String(body_html).trim();
    } else {
      const { professionalProfile, signature, calendly_url: calendlyUrl } = await loadProfessionalNurtureMeta(
        req.user._id,
        bundle.leadMatch,
        req.user,
      );
      const propertyMatches = await nurturePropertyMatchesSnapshot(
        req.user._id,
        bundle.leadMatch,
        professionalProfile,
      );
      const agentName =
        String(signature?.display_name || '').trim() ||
        String(professionalProfile?.full_name || '').trim() ||
        [req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ').trim() ||
        'Your agent';
      htmlForSend = composeNurtureEmailHtml({
        bodyPlain: body,
        listings: propertyMatches.listings || [],
        includePropertyCards: include_property_cards !== false,
        agentName,
        propertyMatchesContext: propertyMatches.context || null,
        propertyMatchesNote: propertyMatches.note || null,
        schedulingUrl: calendlyUrl || null,
      });
    }

    const result = await sendEmail({
      email: recipient,
      subject,
      message: body,
      htmlMessage: htmlForSend,
    });

    const baseLog = nurtureLogPayload({
      userId: req.user._id,
      leadMatch: bundle.leadMatch,
      convId,
      recipient,
      subject,
      body,
      status: result.success ? 'sent' : 'failed',
    });
    await NurtureLog.create(baseLog);

    if (!result.success) {
      return res.status(502).json({ success: false, message: 'Email delivery failed' });
    }

    try {
      await recordLeadKpiEvent({
        user_id: req.user._id,
        lead_match_id: bundle.leadMatch._id,
        conversation_id: convId,
        event_type: 'nurture_email_sent',
        grade: bundle.leadMatch.lead_type?.split('_')[0] || null,
        metadata: { subject_len: String(subject || '').length },
      });
    } catch (kpiErr) {
      logger.warn('nurture KPI event failed', { error: kpiErr.message });
    }

    return res.json({
      success: true,
      message: 'Email sent',
      to_email: recipient,
      ...nurtureLeadIdsResponse(bundle),
    });
  } catch (err) {
    return next(err);
  }
}

function mapNurtureLogRow(r) {
  return {
    id: String(r._id),
    lead_match_id: r.lead_match_id ? String(r.lead_match_id) : null,
    conversation_id: r.conversation_id ? String(r.conversation_id) : null,
    to_email: r.to_email,
    subject: r.subject,
    body: r.body,
    status: r.status,
    meeting_booked: Boolean(r.meeting_booked),
    meeting_booked_at: r.meeting_booked_at ? new Date(r.meeting_booked_at).toISOString() : null,
    sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    created_at: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}

export async function getNurtureLogs(req, res, next) {
  try {
    const { page, limit, skip } = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.leadList);
    const leadMatchId = req.query.lead_match_id;
    const q = { user_id: req.user._id };
    if (leadMatchId && mongoose.Types.ObjectId.isValid(leadMatchId)) {
      q.lead_match_id = new mongoose.Types.ObjectId(leadMatchId);
    }

    const [total, rows] = await Promise.all([
      NurtureLog.countDocuments(q),
      NurtureLog.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    return res.json({
      success: true,
      items: rows.map(mapNurtureLogRow),
      pagination: buildPaginationMeta({ page, limit, total }),
    });
  } catch (err) {
    return next(err);
  }
}
