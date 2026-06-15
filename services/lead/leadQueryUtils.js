import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import { USER_ROLE } from '../../constants/roles.js';
import { getOrCreateSubscriptionForUser } from '../billing/subscriptionService.js';
import { assertLeadMatchPlanVisible } from '../billing/planQuota.js';

export function assertValidLeadId(leadId) {
  if (!mongoose.Types.ObjectId.isValid(String(leadId || ''))) {
    const err = new Error('Invalid lead id');
    err.statusCode = 400;
    throw err;
  }
}

export async function findOwnedLeadMatch(userId, leadId, { select, lean = true } = {}) {
  assertValidLeadId(leadId);
  let query = LeadMatch.findOne({ _id: leadId, user_id: userId });
  if (select) query = query.select(select);
  if (lean) query = query.lean();
  const lead = await query;
  if (!lead) {
    const err = new Error('Lead not found');
    err.statusCode = 404;
    throw err;
  }
  return lead;
}

export async function findOwnedVisibleLeadMatch(userId, leadId, opts = {}) {
  const lead = await findOwnedLeadMatch(userId, leadId, opts);
  const subscription = await getOrCreateSubscriptionForUser({ _id: userId });
  await assertLeadMatchPlanVisible(userId, lead._id, subscription);
  return lead;
}

export function handleLeadServiceError(res, err, next) {
  if (err?.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
  return next(err);
}

export function normalizeProfileIdList(profileIds) {
  return (profileIds || [])
    .map((id) => (id && mongoose.Types.ObjectId.isValid(String(id)) ? String(id) : null))
    .filter(Boolean);
}

export function truthyQueryFlag(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

export const ICP_TIERS = new Set(['perfect_match', 'good_match', 'low_match']);

/** Buyer/seller `intent` is only for agent dashboards; omit for other roles. */
export function leadMapperOptsFromRequest(req) {
  const includeIntentField = req.user?.role === USER_ROLE.AGENT;
  return { includeIntentField };
}

/**
 * LeadMatch rows created for the *recipient* when they accept a referral set
 * `compatibility_factors.referral_id`. Those should not show in GET /leads.
 */
export function excludeAcceptedReferralRecipientMatchesFilter() {
  return {
    $or: [
      { 'compatibility_factors.referral_id': { $exists: false } },
      { 'compatibility_factors.referral_id': null },
    ],
  };
}

export function parseProfileIncludeQuery(q = {}) {
  const raw = String(q.include || '').trim().toLowerCase();
  if (!raw) return { leads: false, nurture_logs: false };
  const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const set = new Set(tokens);
  return {
    leads: set.has('leads'),
    nurture_logs: set.has('nurture_logs') || set.has('nurture-logs'),
  };
}

/** Base LeadMatch filter for GET /api/leads from query params. */
export function buildLeadsListMatchFilter(userId, q = {}) {
  const { embedToken, intent, grade, status, pipeline } = q;
  const match = { user_id: userId };
  const pipelineNorm = String(pipeline || '').trim().toLowerCase();
  if (status) {
    match.match_status = status;
  } else if (pipelineNorm === 'active') {
    match.match_status = { $nin: ['converted', 'closed_lost'] };
  } else if (pipelineNorm === 'closed') {
    match.match_status = { $in: ['converted', 'closed_lost'] };
  } else if (pipelineNorm === 'referrals') {
    match._id = { $in: [] };
  } else {
    match.match_status = { $nin: ['converted', 'closed_lost'] };
  }
  if (grade) match.lead_type = new RegExp(`^${grade}_`);
  if (intent === 'buy' || intent === 'sell') {
    match.lead_type = new RegExp(`${intent === 'sell' ? 'seller' : '(buyer|client)'}$`);
  }
  if (embedToken) match['compatibility_factors.embed_token'] = embedToken;
  return match;
}

export function resolveListIntent(profileView, leadMatch, profile = null) {
  const leadType = String(leadMatch?.lead_type || '').toLowerCase();
  if (/seller/i.test(leadType)) return 'sell';
  if (/(buyer|client)/i.test(leadType)) return 'buy';

  const cfIntent = String(leadMatch?.compatibility_factors?.inquiry_intent || '').trim().toLowerCase();
  if (cfIntent === 'buy' || cfIntent === 'sell') return cfIntent;

  const summaryIntent = String(profile?.intent_summary?.primary_intent || '').trim().toLowerCase();
  if (summaryIntent === 'buy' || summaryIntent === 'sell') return summaryIntent;

  const raw = String(profileView?.intent || '').trim().toLowerCase();
  if (raw === 'buy' || raw === 'sell') return raw;
  if (raw === 'buyer') return 'buy';
  if (raw === 'seller') return 'sell';
  return raw || null;
}
