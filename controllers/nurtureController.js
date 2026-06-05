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
import { withNestiNurtureCalendlyTracking } from '../services/nurture/nurtureCalendlyTracking.js';
import { ownerQuery } from '../services/lead/leadProfileHelpers.js';

function normalizeProfessionalType(raw) {
  const role = String(raw || '').trim().toLowerCase();
  if (role === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  if (role === PROFESSIONAL_TYPE.AGENT) return PROFESSIONAL_TYPE.AGENT;
  return null;
}

function shouldIncludePropertyCards(user, includePropertyCardsFlag) {
  const viewerRole = normalizeProfessionalType(user?.role);
  if (viewerRole !== PROFESSIONAL_TYPE.AGENT) return false;
  return includePropertyCardsFlag !== false;
}

function resolveNurtureOperatingRole(leadMatch, referralContext, viewerRoleRaw) {
  const isReferralNurture =
    Boolean(referralContext) || Boolean(leadMatch?.compatibility_factors?.referral_id);
  if (!isReferralNurture) {
    return (
      normalizeProfessionalType(leadMatch?.compatibility_factors?.professional_type) ||
      PROFESSIONAL_TYPE.AGENT
    );
  }
  const viewerRole = normalizeProfessionalType(viewerRoleRaw);
  if (viewerRole) return viewerRole;
  const action = normalizeProfessionalType(referralContext?.action_professional_role);
  if (action) return action;
  const target = normalizeProfessionalType(referralContext?.target_professional_role);
  if (target) return target;
  return (
    normalizeProfessionalType(leadMatch?.compatibility_factors?.professional_type) ||
    PROFESSIONAL_TYPE.AGENT
  );
}

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

/** Latest LeadMatch for this user + profile (same sort as nurture draft/send). */
async function findLatestLeadMatchForProfileLean(userId, leadProfileId) {
  if (!mongoose.Types.ObjectId.isValid(String(leadProfileId))) return null;
  return LeadMatch.findOne({
    user_id:         userId,
    lead_profile_id: new mongoose.Types.ObjectId(String(leadProfileId)),
  })
    .sort({ last_contact_at: -1, updatedAt: -1, createdAt: -1 })
    .lean();
}

/**
 * Resolve nurture bundle by LeadMatch id or by LeadProfile id (latest match for this professional).
 */
async function loadLeadBundleForNurture(userId, { lead_match_id, lead_profile_id }) {
  if (lead_match_id && mongoose.Types.ObjectId.isValid(String(lead_match_id))) {
    return loadLeadBundle(userId, lead_match_id);
  }
  if (lead_profile_id && mongoose.Types.ObjectId.isValid(String(lead_profile_id))) {
    const leadMatch = await findLatestLeadMatchForProfileLean(userId, lead_profile_id);
    if (!leadMatch) {
      const profile = await LeadProfile.findOne({
        _id: new mongoose.Types.ObjectId(String(lead_profile_id)),
        ...ownerQuery(userId),
      }).lean();
      if (!profile) return null;
      return {
        leadMatch: {
          _id: null,
          user_id: userId,
          lead_profile_id: profile._id,
          conversation_id: null,
          lead_type: profile.intent === 'sell' ? 'unknown_seller' : 'unknown_buyer',
          match_score: null,
          match_status: 'new',
          compatibility_factors: { professional_type: PROFESSIONAL_TYPE.AGENT, contact: {} },
        },
        profile,
        conversation: null,
      };
    }
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

const PRO_NURTURE_SELECT = 'professional_type full_name phone calendly_link';

function resolveProfessionalCalendlyUrl(professionalProfile, leadMatch) {
  if (!professionalProfile) return '';
  const flowRole =
    leadMatch?.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
  if (flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return resolveMortgageCalendlyUrl(professionalProfile);
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
  const leadProfileId = leadMatch?.lead_profile_id || null;
  return {
    user_id: userId,
    lead_match_id: leadMatch?._id || null,
    lead_profile_id: leadProfileId,
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

/** Draft/refine API responses expose plain text plus compact property-match preview for UI. */
function nurtureDraftJsonResponse(draft, propertyMatches) {
  const listings = Array.isArray(propertyMatches?.listings) ? propertyMatches.listings : [];
  return {
    subject: draft.subject,
    body_text: draft.body_text,
    property_matches_preview: listings.map((L, i) => ({
      i: i + 1,
      title: L?.title || null,
      location: L?.location || L?.address || null,
      price: L?.price != null ? Number(L.price) : null,
      match_score: L?.match_score != null ? Number(L.match_score) : null,
      source: L?.source || null,
    })),
    property_matches_count: listings.length,
  };
}

async function nurturePropertyMatchesSnapshot(
  userId,
  leadMatch,
  leadProfile,
  professionalProfile,
  referralContext = null,
  viewerRoleRaw = null,
) {
  const isReferralNurture =
    Boolean(referralContext) || Boolean(leadMatch?.compatibility_factors?.referral_id);
  const missingConversationId = !leadMatch?.conversation_id;
  const operatingRole = resolveNurtureOperatingRole(leadMatch, referralContext, viewerRoleRaw);
  return loadPropertyMatchesForNurtureEmail({
    userId,
    conversationId: leadMatch?.conversation_id,
    leadProfessionalType: operatingRole,
    professionalProfile,
    leadProfile: leadProfile || null,
    leadMatch: leadMatch || null,
    // Direct inquiry leads can be created without chat threads; use profile-based match fallback.
    enableProfileFallback: isReferralNurture || missingConversationId,
  });
}

export async function postNurtureDraft(req, res, next) {
  try {
    if (!process.env.OPENAI_API_KEY) return openAiUnavailable(res);
    const { lead_match_id, lead_profile_id, goal, tone, referral_context } = req.body;
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
    const trackedCalendlyUrl = withNestiNurtureCalendlyTracking(
      calendly_url,
      { conversationId: bundle.leadMatch?.conversation_id, ownerUserId: req.user._id },
    );
    const propertyMatches = await nurturePropertyMatchesSnapshot(
      req.user._id,
      bundle.leadMatch,
      bundle.profile,
      professionalProfile,
      referral_context || null,
      req.user?.role || null,
    );
    const leadContext = buildLeadContext(bundle.leadMatch, bundle.profile, bundle.conversation, {
      property_matches: propertyMatches,
      viewer_professional_role: req.user?.role || null,
      is_referral_nurture: Boolean(
        referral_context || bundle.leadMatch?.compatibility_factors?.referral_id,
      ),
      referral_context: referral_context || null,
    });
    const draftRaw = await generateDraft(leadContext, {
      goal,
      tone,
    });
    const draft = finalizeNurtureDraftBody(draftRaw, { calendly_url: trackedCalendlyUrl, signature });
    return res.json({
      success: true,
      ...nurtureLeadIdsResponse(bundle),
      calendly_url: trackedCalendlyUrl || calendly_url || null,
      draft: nurtureDraftJsonResponse(draft, propertyMatches),
    });
  } catch (err) {
    return handleNurtureAiException(err, res, next, 'nurture draft');
  }
}

export async function postNurtureRefine(req, res, next) {
  try {
    if (!process.env.OPENAI_API_KEY) return openAiUnavailable(res);
    const { lead_match_id, lead_profile_id, subject, body, instruction, referral_context } = req.body;
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

    const { calendly_url: calRaw, signature, professionalProfile } = await loadProfessionalNurtureMeta(
      req.user._id,
      bundle.leadMatch,
      req.user,
    );
    const calendly_url = withNestiNurtureCalendlyTracking(calRaw, {
      conversationId: bundle.leadMatch?.conversation_id,
      ownerUserId: req.user._id,
    });
    const bodyForAi = stripServerAppendedNurturePlainFooter(body, calendly_url, signature);
    const propertyMatches = await nurturePropertyMatchesSnapshot(
      req.user._id,
      bundle.leadMatch,
      bundle.profile,
      professionalProfile,
      referral_context || null,
      req.user?.role || null,
    );
    const leadContext = buildLeadContext(bundle.leadMatch, bundle.profile, bundle.conversation, {
      property_matches: propertyMatches,
      viewer_professional_role: req.user?.role || null,
      is_referral_nurture: Boolean(
        referral_context || bundle.leadMatch?.compatibility_factors?.referral_id,
      ),
      referral_context: referral_context || null,
    });
    const draftRaw = await refineDraft(leadContext, { subject, body_text: bodyForAi }, instruction);
    const draft = finalizeNurtureDraftBody(draftRaw, { calendly_url, signature });
    return res.json({
      success: true,
      ...nurtureLeadIdsResponse(bundle),
      calendly_url: calendly_url || null,
      draft: nurtureDraftJsonResponse(draft, propertyMatches),
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
      referral_context,
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
      const { professionalProfile, signature, calendly_url: calRaw } = await loadProfessionalNurtureMeta(
        req.user._id,
        bundle.leadMatch,
        req.user,
      );
      const calendlyUrl = withNestiNurtureCalendlyTracking(calRaw, {
        conversationId: convId || bundle.leadMatch?.conversation_id,
        ownerUserId: req.user._id,
      });
      const propertyMatches = await nurturePropertyMatchesSnapshot(
        req.user._id,
        bundle.leadMatch,
        bundle.profile,
        professionalProfile,
        referral_context || null,
        req.user?.role || null,
      );
      const agentName =
        String(signature?.display_name || '').trim() ||
        String(professionalProfile?.full_name || '').trim() ||
        [req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ').trim() ||
        'Your agent';
      const bodyForTemplate = stripServerAppendedNurturePlainFooter(body, calendlyUrl, signature);
      const isReferralNurture =
        Boolean(referral_context) || Boolean(bundle.leadMatch?.compatibility_factors?.referral_id);
      const nurtureOperatingRole = resolveNurtureOperatingRole(
        bundle.leadMatch,
        referral_context || null,
        req.user?.role || null,
      );
      const listingTableColumns =
        isReferralNurture && nurtureOperatingRole === PROFESSIONAL_TYPE.AGENT
          ? 'location_budget'
          : 'score_notes';
      htmlForSend = composeNurtureEmailHtml({
        bodyPlain: bodyForTemplate,
        listings: propertyMatches.listings || [],
        includePropertyCards: shouldIncludePropertyCards(req.user, include_property_cards),
        agentName,
        propertyMatchesContext: propertyMatches.context || null,
        propertyMatchesNote: propertyMatches.note || null,
        schedulingUrl: calendlyUrl || null,
        signature,
        listingTableColumns,
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

    if (bundle.leadMatch?._id) {
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

export async function postNurturePreview(req, res, next) {
  try {
    const {
      lead_match_id,
      lead_profile_id,
      conversation_id,
      subject,
      body,
      body_html,
      include_property_cards,
      referral_context,
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

    const convId = resolveConversationId(conversation_id, bundle.leadMatch);
    const customHtml = body_html != null && String(body_html).trim();
    let htmlPreview;
    let calendly_url = null;

    if (customHtml) {
      htmlPreview = String(body_html).trim();
    } else {
      const { professionalProfile, signature, calendly_url: calRaw } = await loadProfessionalNurtureMeta(
        req.user._id,
        bundle.leadMatch,
        req.user,
      );
      const calendlyUrl = withNestiNurtureCalendlyTracking(calRaw, {
        conversationId: convId || bundle.leadMatch?.conversation_id,
        ownerUserId: req.user._id,
      });
      calendly_url = calendlyUrl || null;
      const propertyMatches = await nurturePropertyMatchesSnapshot(
        req.user._id,
        bundle.leadMatch,
        bundle.profile,
        professionalProfile,
        referral_context || null,
        req.user?.role || null,
      );
      const agentName =
        String(signature?.display_name || '').trim() ||
        String(professionalProfile?.full_name || '').trim() ||
        [req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ').trim() ||
        'Your agent';
      const bodyForTemplate = stripServerAppendedNurturePlainFooter(body, calendlyUrl, signature);
      const isReferralNurture =
        Boolean(referral_context) || Boolean(bundle.leadMatch?.compatibility_factors?.referral_id);
      const nurtureOperatingRole = resolveNurtureOperatingRole(
        bundle.leadMatch,
        referral_context || null,
        req.user?.role || null,
      );
      const listingTableColumns =
        isReferralNurture && nurtureOperatingRole === PROFESSIONAL_TYPE.AGENT
          ? 'location_budget'
          : 'score_notes';
      htmlPreview = composeNurtureEmailHtml({
        bodyPlain: bodyForTemplate,
        listings: propertyMatches.listings || [],
        includePropertyCards: shouldIncludePropertyCards(req.user, include_property_cards),
        agentName,
        propertyMatchesContext: propertyMatches.context || null,
        propertyMatchesNote: propertyMatches.note || null,
        schedulingUrl: calendlyUrl || null,
        signature,
        listingTableColumns,
      });
    }

    return res.json({
      success: true,
      ...nurtureLeadIdsResponse(bundle),
      conversation_id: convId ? String(convId) : null,
      calendly_url,
      preview: {
        subject: String(subject || '').trim() || null,
        html: htmlPreview,
      },
    });
  } catch (err) {
    return next(err);
  }
}

function mapNurtureLogRow(r) {
  return {
    id: String(r._id),
    lead_match_id: r.lead_match_id ? String(r.lead_match_id) : null,
    lead_profile_id: r.lead_profile_id ? String(r.lead_profile_id) : null,
    conversation_id: r.conversation_id ? String(r.conversation_id) : null,
    calendly_scheduled_start: r.calendly_scheduled_start
      ? new Date(r.calendly_scheduled_start).toISOString()
      : null,
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
    const qp = req.query || {};
    const leadMatchIdRaw = qp.lead_match_id;
    const leadProfileIdRaw = qp.lead_profile_id;
    const explicitMatch = Object.prototype.hasOwnProperty.call(qp, 'lead_match_id');
    const explicitProfile = Object.prototype.hasOwnProperty.call(qp, 'lead_profile_id');

    const q = { user_id: req.user._id };

    if (explicitMatch) {
      const s = leadMatchIdRaw != null ? String(leadMatchIdRaw).trim() : '';
      if (!s || !mongoose.Types.ObjectId.isValid(s)) {
        return res.json({
          success: true,
          items: [],
          pagination: buildPaginationMeta({ page, limit, total: 0 }),
        });
      }
      q.lead_match_id = new mongoose.Types.ObjectId(s);
    } else if (explicitProfile) {
      const s = leadProfileIdRaw != null ? String(leadProfileIdRaw).trim() : '';
      if (!s || !mongoose.Types.ObjectId.isValid(s)) {
        return res.json({
          success: true,
          items: [],
          pagination: buildPaginationMeta({ page, limit, total: 0 }),
        });
      }
      const leadMatch = await findLatestLeadMatchForProfileLean(req.user._id, s);
      if (!leadMatch) {
        return res.json({
          success: true,
          items: [],
          pagination: buildPaginationMeta({ page, limit, total: 0 }),
        });
      }
      q.lead_match_id = leadMatch._id;
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
