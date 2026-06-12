import crypto from 'crypto';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import LeadAttribution from '../../models/LeadAttribution.js';
import ChatConversation from '../../models/ChatConversation.js';
import ChatMessage from '../../models/ChatMessage.js';
import logger from '../../utils/logger.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { AGENT_NOTES_MAX_ENTRIES, isTerminalMatchStatus } from '../../utils/leadMatchStatus.js';
import { recordLeadKpiEvent } from '../analytics/leadKpiService.js';
import { awardReferralPoints, REWARD_RULES } from '../referral/rewardService.js';
import { awardInviterMilestoneForUser } from '../referral/inviteService.js';
import { emitWorkspaceLeadEvent } from '../realtime/workspaceSocket.js';
import { assertValidLeadId, findOwnedVisibleLeadMatch } from './leadQueryUtils.js';

/**
 * Keeps LeadProfile.lifecycle.status aligned with aggregate outcomes of all
 * LeadMatch rows for this profile (same workspace user).
 */
export async function recomputeLeadProfileLifecycle(userId, leadProfileId) {
  if (!leadProfileId) return;
  const matches = await LeadMatch.find({
    user_id: userId,
    lead_profile_id: leadProfileId,
  })
    .select('match_status')
    .lean();
  if (!matches.length) return;

  const anyWon = matches.some((m) => m.match_status === 'converted');
  const allLost =
    matches.length > 0 && matches.every((m) => m.match_status === 'closed_lost');

  let lifecycleStatus;
  if (anyWon) lifecycleStatus = 'customer';
  else if (allLost) lifecycleStatus = 'closed_lost';
  else lifecycleStatus = 'active';

  await LeadProfile.updateOne(
    { _id: leadProfileId, 'ownership.user_id': userId },
    { $set: { 'lifecycle.status': lifecycleStatus } }
  );
}

/**
 * Attribution.converted reflects whether this specific inquiry (match) is won.
 * Prefers lead_match_id (new rows); falls back to lead_profile_id + session_id for legacy attributions.
 */
export async function syncLeadAttributionForMatchStatus(leadMatch, matchStatus) {
  const isConverted = matchStatus === 'converted';
  const matchId = leadMatch._id;
  const profileId = leadMatch.lead_profile_id;
  const sessionId =
    leadMatch.compatibility_factors && typeof leadMatch.compatibility_factors === 'object'
      ? leadMatch.compatibility_factors.session_id
      : null;

  const byMatch = await LeadAttribution.updateMany(
    { lead_match_id: matchId },
    { $set: { converted: isConverted } }
  );
  if (byMatch.matchedCount > 0) return;

  if (profileId && sessionId) {
    await LeadAttribution.updateMany(
      { lead_profile_id: profileId, session_id: sessionId },
      { $set: { converted: isConverted } }
    );
  }
}

export function assertMatchStatusTransition(prevStatus, nextStatus) {
  if (prevStatus === nextStatus) return;
  if (isTerminalMatchStatus(prevStatus)) {
    if (isTerminalMatchStatus(nextStatus)) return;
    if (nextStatus !== 'nurturing' && nextStatus !== 'new') {
      const err = new Error('Closed leads can only be reopened to Nurturing or New');
      err.statusCode = 400;
      throw err;
    }
  }
}

const ROLE_CLOSE_REASONS = {
  agent: {
    converted: new Set(['deal_closed', 'buyer_found_match', 'seller_accepted_offer', 'other']),
    closed_lost: new Set(['went_with_another_agent', 'changed_mind', 'not_ready', 'unresponsive', 'other']),
  },
  lawyer: {
    converted: new Set(['matter_retained', 'case_completed', 'other']),
    closed_lost: new Set(['went_elsewhere', 'declined_service', 'matter_withdrawn', 'other']),
  },
  mortgage_broker: {
    converted: new Set(['loan_funded', 'pre_approval_secured', 'other']),
    closed_lost: new Set(['went_with_another_lender', 'application_denied', 'not_qualified', 'other']),
  },
};

export function leadProfessionalType(lead, professionalTypeOverride = '') {
  const override = String(professionalTypeOverride || '')
    .trim()
    .toLowerCase();
  if (override === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (override === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  if (override === PROFESSIONAL_TYPE.AGENT) return PROFESSIONAL_TYPE.AGENT;
  const raw = String(
    lead?.compatibility_factors?.professional_type ||
      lead?.professional_type ||
      '',
  )
    .trim()
    .toLowerCase();
  if (raw === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (raw === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  return PROFESSIONAL_TYPE.AGENT;
}

export function validateCloseReasonForLead({ lead, nextStatus, closeReason, professionalTypeOverride = '' }) {
  if (!isTerminalMatchStatus(nextStatus)) return null;
  const reason = String(closeReason || '').trim();
  if (!reason) return 'close_reason is required when closing a lead';
  const role = leadProfessionalType(lead, professionalTypeOverride);
  const allowed =
    ROLE_CLOSE_REASONS[role]?.[nextStatus] ||
    ROLE_CLOSE_REASONS[PROFESSIONAL_TYPE.AGENT][nextStatus];
  if (!allowed || !allowed.has(reason)) {
    return `Invalid close_reason '${reason}' for ${role.replace('_', ' ')} lead`;
  }
  return null;
}

export function isReferralRecipientLead(lead) {
  const factors =
    lead?.compatibility_factors && typeof lead.compatibility_factors === 'object'
      ? lead.compatibility_factors
      : {};
  return Boolean(
    String(factors.referral_id || '').trim() ||
      String(factors.referral_source_user_id || '').trim(),
  );
}

export async function patchLeadMatchForUser({ userId, user, leadId, body }) {
  assertValidLeadId(leadId);
  const { match_status: nextStatus, note } = body || {};
  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  const hasNote = trimmedNote.length > 0;
  const hasStatus = nextStatus !== undefined;
  if (!hasStatus && !hasNote) {
    const err = new Error('Provide match_status and/or a non-empty note');
    err.statusCode = 400;
    throw err;
  }

  const lead = await LeadMatch.findOne({ _id: leadId, user_id: userId });
  if (!lead) {
    const err = new Error('Lead not found');
    err.statusCode = 404;
    throw err;
  }

  const { getOrCreateSubscriptionForUser } = await import('../billing/subscriptionService.js');
  const { assertLeadMatchPlanVisible } = await import('../billing/planQuota.js');
  const subscription = await getOrCreateSubscriptionForUser({ _id: userId });
  await assertLeadMatchPlanVisible(userId, lead._id, subscription);

  const prevStatus = lead.match_status;
  if (hasStatus) assertMatchStatusTransition(prevStatus, nextStatus);
  if (hasStatus && nextStatus !== prevStatus && isReferralRecipientLead(lead)) {
    const closeValidationError = validateCloseReasonForLead({
      lead,
      nextStatus,
      closeReason: body?.close_reason,
      professionalTypeOverride: user?.role,
    });
    if (closeValidationError) {
      const err = new Error(closeValidationError);
      err.statusCode = 400;
      throw err;
    }
  }

  const statusChanged = hasStatus && nextStatus !== prevStatus;
  const authorLabel = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null;
  const authorUserIdStr = userId != null ? String(userId) : null;
  const now = new Date().toISOString();
  const notesToPush = [];

  if (statusChanged && !hasNote) {
    const readable = (s) => ({
      new: 'New',
      nurturing: 'Nurturing',
      converted: 'Closed — won',
      closed_lost: 'Closed — lost',
      consult_booked: 'Consult booked',
      showing_booked: 'Showing booked',
    }[s] || s);
    notesToPush.push({
      id: crypto.randomUUID(),
      text: `Status changed from ${readable(prevStatus)} to ${readable(nextStatus)}`,
      created_at: now,
      author_user_id: authorUserIdStr,
      author_label: authorLabel,
      system: true,
    });
  }

  if (hasNote) {
    notesToPush.push({
      id: crypto.randomUUID(),
      text: trimmedNote.slice(0, 8000),
      created_at: now,
      author_user_id: authorUserIdStr,
      author_label: authorLabel,
    });
  }

  const mongoUpdate = {};
  if (statusChanged) mongoUpdate.$set = { match_status: nextStatus };

  const wasTerminal = isTerminalMatchStatus(prevStatus);
  if (statusChanged && isTerminalMatchStatus(nextStatus)) {
    mongoUpdate.$set = {
      ...mongoUpdate.$set,
      'compatibility_factors.close_summary': {
        status: nextStatus,
        reason: body.close_reason || null,
        note: body.close_note || null,
        value: body.closed_value ?? null,
        closed_at: now,
        closed_by_user_id: authorUserIdStr,
        closed_by_label: authorLabel,
      },
    };
  } else if (statusChanged && wasTerminal && !isTerminalMatchStatus(nextStatus)) {
    mongoUpdate.$set = {
      ...mongoUpdate.$set,
      'compatibility_factors.close_summary.reopened_at': now,
    };
  }

  if (notesToPush.length) {
    mongoUpdate.$push = {
      'compatibility_factors.agent_notes': {
        $each: notesToPush,
        $slice: -AGENT_NOTES_MAX_ENTRIES,
      },
    };
  }

  const dirty = Object.keys(mongoUpdate).length > 0;
  if (dirty) {
    let updatedOk = false;
    try {
      const result = await LeadMatch.updateOne({ _id: lead._id, user_id: userId }, mongoUpdate);
      if (result.matchedCount === 0) {
        const err = new Error('Lead not found');
        err.statusCode = 404;
        throw err;
      }
      updatedOk = true;
    } catch (mongoErr) {
      if (mongoErr?.statusCode) throw mongoErr;
      logger.warn('LeadMatch updateOne failed; falling back to document save', {
        leadId: String(lead._id),
        error: mongoErr.message,
      });
      if (statusChanged) lead.match_status = nextStatus;
      if (notesToPush.length) {
        const factors =
          lead.compatibility_factors && typeof lead.compatibility_factors === 'object'
            ? { ...lead.compatibility_factors }
            : {};
        const existing = Array.isArray(factors.agent_notes) ? [...factors.agent_notes] : [];
        for (const n of notesToPush) existing.push(n);
        factors.agent_notes = existing.slice(-AGENT_NOTES_MAX_ENTRIES);
        lead.compatibility_factors = factors;
        lead.markModified('compatibility_factors');
      }
      await lead.save();
      updatedOk = true;
    }

    if (updatedOk && statusChanged) {
      try {
        await syncLeadAttributionForMatchStatus(lead, nextStatus);
        if (lead.lead_profile_id) {
          await recomputeLeadProfileLifecycle(userId, lead.lead_profile_id);
        }
      } catch (syncErr) {
        logger.warn('Lead follow-up sync failed (attribution/lifecycle); lead update kept', {
          leadId: String(lead._id),
          error: syncErr.message,
        });
      }
      if (nextStatus === 'converted' && prevStatus !== 'converted') {
        recordLeadKpiEvent({
          user_id: userId,
          lead_match_id: lead._id,
          conversation_id: lead.conversation_id || null,
          event_type: 'lead_updated',
          metadata: { match_status: 'converted', deal_closed: true },
        }).catch(() => {});
        awardReferralPoints({
          user_id: userId,
          event_type: 'deal_closed',
          points_delta: REWARD_RULES.deal_closed,
          idempotency_key: `lead:deal_closed:${String(lead._id)}`,
          source_model: 'LeadMatch',
          source_id: String(lead._id),
        }).catch((e) => logger.warn('deal_closed reward failed', { error: e?.message }));
        awardInviterMilestoneForUser(userId, 'pro_first_deal', String(lead._id)).catch(() => {});
      }
      if (nextStatus === 'nurturing' && prevStatus === 'new') {
        awardReferralPoints({
          user_id: userId,
          event_type: 'lead_active_client',
          points_delta: REWARD_RULES.lead_active_client,
          idempotency_key: `lead:active_client:${String(lead._id)}`,
          source_model: 'LeadMatch',
          source_id: String(lead._id),
        }).catch((e) => logger.warn('lead_active_client reward failed', { error: e?.message }));
      }
    }
    emitWorkspaceLeadEvent(userId, {
      kind: 'lead_updated',
      lead_match_id: String(lead._id),
      match_status: statusChanged ? nextStatus : prevStatus,
    });
  }

  const leadMatch = await LeadMatch.findOne({ _id: lead._id, user_id: userId }).lean();
  if (!leadMatch) {
    const err = new Error('Lead not found');
    err.statusCode = 404;
    throw err;
  }
  return leadMatch;
}

export async function deleteOwnedLeadMatch(userId, leadId) {
  const leadMatch = await findOwnedVisibleLeadMatch(userId, leadId, { lean: false });

  const { lead_profile_id: profileId, conversation_id: conversationId, _id: leadMatchId } = leadMatch;
  await LeadMatch.deleteOne({ _id: leadMatchId });

  if (profileId) {
    await LeadProfile.findByIdAndUpdate(profileId, { $pull: { lead_refs: leadMatchId } });
    if (await LeadMatch.countDocuments({ lead_profile_id: profileId }) === 0) {
      await Promise.all([
        LeadProfile.deleteOne({ _id: profileId }),
        LeadAttribution.deleteMany({ lead_profile_id: profileId }),
      ]);
    }
  }
  if (conversationId) {
    await Promise.all([
      ChatConversation.deleteOne({ _id: conversationId }),
      ChatMessage.deleteMany({ conversation_id: conversationId }),
    ]);
  }
}
