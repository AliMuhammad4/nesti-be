import mongoose from 'mongoose';
import Referral from '../../models/Referral.js';
import User from '../../models/User.js';
import LeadMatch from '../../models/LeadMatch.js';
import CalendarIntegration from '../../models/CalendarIntegration.js';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import { ok, fail, USER_PUBLIC } from './adminCommon.js';
import { findOwnedLeadMatch } from '../lead/leadQueryUtils.js';
import { postClientInquiryDirectConversationMessage } from '../lead/leadProfileHelpers.js';
import {
  createReferralForUser,
  patchReferralForUser,
  mapReferralsListToApiItems,
  processReferralForTarget,
  buildReferralLeadDetailsResponse,
} from '../referral/referralService.js';
import {
  postNurtureDraft,
  postNurtureRefine,
  postNurturePreview,
  postNurtureSend,
  listNurtureLogsForUser,
} from '../../controllers/nurtureController.js';
import { cancelCalendlyScheduledEvent } from '../calendly/cancelCalendlyBooking.js';
import { applyCalendlyCancellationToLeadForUser } from '../calendly/calendlyWebhookService.js';
import { refreshCalendlyAccessToken } from '../calendly/oauthService.js';
import { recordAdminAudit } from './adminAuditService.js';

export const adminLeadOwnerActionDeps = {
  createReferralForUser,
  processReferralForTarget,
  recordAdminAudit,
  Referral,
};

const CALENDLY_REFRESH_SKEW_MS = 5 * 60 * 1000;

async function loadLeadOwner(leadId) {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return fail(400, 'Invalid lead id');
  const lead = await LeadMatch.findById(leadId).lean();
  if (!lead) return fail(404, 'Lead not found');
  const owner = await User.findById(lead.user_id).select(USER_PUBLIC).lean();
  if (!owner) return fail(409, 'Lead owner account no longer exists');
  return { lead, owner };
}

function actorId(actorUser) {
  return actorUser?._id || actorUser?.id || null;
}

function invokeAsOwner(handler, owner, { body = {}, query = {}, params = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { user: owner, body, query, params };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode || 200, body: payload });
        return this;
      },
    };
    Promise.resolve(
      handler(req, res, (err) => {
        if (err) reject(err);
      }),
    ).catch(reject);
  });
}

async function loadOwnerCalendlyIntegration(userId) {
  let integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' });
  if (!integ?.access_token) {
    return { error: fail(400, 'Connect Calendly (OAuth) first for this professional.') };
  }
  const expiresAt = integ.expires_at ? new Date(integ.expires_at).getTime() : 0;
  const staleOrUnknownExpiry = !expiresAt || expiresAt < Date.now() + CALENDLY_REFRESH_SKEW_MS;
  if (staleOrUnknownExpiry && integ.refresh_token) {
    try {
      const tokens = await refreshCalendlyAccessToken(integ.refresh_token);
      integ.access_token = tokens.access_token;
      if (tokens.refresh_token) integ.refresh_token = tokens.refresh_token;
      integ.expires_at = new Date(Date.now() + (Number(tokens.expires_in) || 7200) * 1000);
      await integ.save();
    } catch {
      return {
        error: fail(400, 'Calendly token refresh failed. Reconnect Calendly for this professional.'),
      };
    }
  }
  return { integ };
}

async function auditOwnerAction({
  actorUser,
  owner,
  action,
  targetType,
  targetId,
  meta = {},
  result,
}) {
  const okResult = result?.status === 200 || result?.body?.success !== false;
  await recordAdminAudit({
    actorUserId: actorId(actorUser),
    onBehalfOfUserId: owner?._id,
    action,
    targetType,
    targetId,
    meta,
    outcome: okResult ? 'ok' : 'error',
    errorMessage: okResult ? '' : result?.body?.message || '',
  });
}

export async function adminPostLeadConversationMessageService(leadId, body = {}, actorUser = null) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  try {
    const leadMatch = await findOwnedLeadMatch(loaded.owner._id, leadId, { lean: false });
    const payload = await postClientInquiryDirectConversationMessage(
      loaded.owner._id,
      leadId,
      leadMatch,
      body?.body ?? body?.message ?? body,
    );
    const result = ok(payload);
    await auditOwnerAction({
      actorUser,
      owner: loaded.owner,
      action: 'lead.conversation.message',
      targetType: 'LeadMatch',
      targetId: leadId,
      result,
    });
    return result;
  } catch (err) {
    await recordAdminAudit({
      actorUserId: actorId(actorUser),
      onBehalfOfUserId: loaded.owner._id,
      action: 'lead.conversation.message',
      targetType: 'LeadMatch',
      targetId: leadId,
      outcome: 'error',
      errorMessage: err?.message,
    });
    return fail(err.statusCode || 400, err.message || 'Could not send message');
  }
}

export async function adminNurtureDraftService(leadId, body = {}, actorUser = null) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  const result = await invokeAsOwner(postNurtureDraft, loaded.owner, {
    body: { ...body, lead_match_id: leadId },
  });
  await auditOwnerAction({
    actorUser,
    owner: loaded.owner,
    action: 'lead.nurture.draft',
    targetType: 'LeadMatch',
    targetId: leadId,
    result,
  });
  return result;
}

export async function adminNurtureRefineService(leadId, body = {}, actorUser = null) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  const result = await invokeAsOwner(postNurtureRefine, loaded.owner, {
    body: { ...body, lead_match_id: leadId },
  });
  await auditOwnerAction({
    actorUser,
    owner: loaded.owner,
    action: 'lead.nurture.refine',
    targetType: 'LeadMatch',
    targetId: leadId,
    result,
  });
  return result;
}

export async function adminNurturePreviewService(leadId, body = {}, actorUser = null) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  const result = await invokeAsOwner(postNurturePreview, loaded.owner, {
    body: { ...body, lead_match_id: leadId },
  });
  await auditOwnerAction({
    actorUser,
    owner: loaded.owner,
    action: 'lead.nurture.preview',
    targetType: 'LeadMatch',
    targetId: leadId,
    result,
  });
  return result;
}

export async function adminNurtureSendService(leadId, body = {}, actorUser = null) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  const result = await invokeAsOwner(postNurtureSend, loaded.owner, {
    body: { ...body, lead_match_id: leadId },
  });
  await auditOwnerAction({
    actorUser,
    owner: loaded.owner,
    action: 'lead.nurture.send',
    targetType: 'LeadMatch',
    targetId: leadId,
    result,
  });
  return result;
}

export async function adminNurtureLogsService(leadId, query = {}) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  const result = await listNurtureLogsForUser(loaded.owner._id, {
    leadMatchId: leadId,
    page,
    limit,
    skip,
  });
  return ok(result);
}

export async function adminListLeadReferralsService(leadId) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  const uid = loaded.owner._id;
  const list = await Referral.find({
    lead_match_id: loaded.lead._id,
    $or: [{ user_id: uid }, { target_user_id: uid }],
  })
    .populate('user_id', 'first_name last_name full_name email role profile_image')
    .populate('target_user_id', 'first_name last_name full_name email role profile_image')
    .sort({ updatedAt: -1 })
    .lean();
  const items = await mapReferralsListToApiItems(list, uid);
  return ok({ lead_match_id: String(loaded.lead._id), items });
}

export async function adminCreateLeadReferralService(leadId, body = {}, actorUser = null) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;

  // Never persist accepted directly — create pending, then run processReferralForTarget
  // so quota, recipient lead, notifications, and rewards stay intact.
  const requestedStatus = String(body?.status || '').trim().toLowerCase();
  const wantsAccepted = requestedStatus === 'accepted';
  const createBody = { ...body, lead_match_id: leadId };
  if (wantsAccepted) {
    delete createBody.status;
  }

  const result = await adminLeadOwnerActionDeps.createReferralForUser(loaded.owner._id, createBody);
  if (!result.ok) {
    await adminLeadOwnerActionDeps.recordAdminAudit({
      actorUserId: actorId(actorUser),
      onBehalfOfUserId: loaded.owner._id,
      action: 'lead.referral.create',
      targetType: 'LeadMatch',
      targetId: leadId,
      outcome: 'error',
      errorMessage: result.message,
    });
    return fail(result.code || 400, result.message || 'Could not create referral');
  }

  let referral = result.referral;
  if (wantsAccepted) {
    const referralId = referral?.id || referral?._id;
    const referralDoc = await adminLeadOwnerActionDeps.Referral.findById(referralId);
    if (!referralDoc) {
      return fail(500, 'Referral was created but could not be loaded for acceptance');
    }
    const processed = await adminLeadOwnerActionDeps.processReferralForTarget(
      referralDoc,
      referralDoc.target_user_id,
    );
    if (!processed.ok) {
      await adminLeadOwnerActionDeps.recordAdminAudit({
        actorUserId: actorId(actorUser),
        onBehalfOfUserId: referralDoc.target_user_id,
        action: 'lead.referral.create.accept',
        targetType: 'Referral',
        targetId: referralId,
        outcome: 'error',
        errorMessage: processed.message,
      });
      return fail(
        processed.code || 400,
        processed.message || 'Referral created but could not be accepted',
      );
    }
    referral = processed.referral || referral;
  }

  await adminLeadOwnerActionDeps.recordAdminAudit({
    actorUserId: actorId(actorUser),
    onBehalfOfUserId: loaded.owner._id,
    action: 'lead.referral.create',
    targetType: 'Referral',
    targetId: referral?.id || referral?._id,
    meta: { lead_match_id: leadId, accepted: wantsAccepted },
    outcome: 'ok',
  });
  return ok({
    referral,
    message: wantsAccepted
      ? 'Referral processed and lead added for the recipient.'
      : undefined,
  });
}

export async function adminPatchReferralAsProfessionalService(
  referralId,
  patch = {},
  actingUserId,
  actorUser = null,
) {
  if (!mongoose.Types.ObjectId.isValid(referralId)) return fail(400, 'Invalid referral id');
  if (!mongoose.Types.ObjectId.isValid(String(actingUserId || ''))) {
    return fail(400, 'acting_user_id is required');
  }
  const result = await patchReferralForUser(actingUserId, referralId, {
    status: patch.status,
    notes: patch.notes,
  });
  if (!result.ok) {
    await recordAdminAudit({
      actorUserId: actorId(actorUser),
      onBehalfOfUserId: actingUserId,
      action: 'referral.patch_as_professional',
      targetType: 'Referral',
      targetId: referralId,
      outcome: 'error',
      errorMessage: result.message,
    });
    return fail(result.code || 400, result.message || 'Could not update referral');
  }
  await recordAdminAudit({
    actorUserId: actorId(actorUser),
    onBehalfOfUserId: actingUserId,
    action: 'referral.patch_as_professional',
    targetType: 'Referral',
    targetId: referralId,
    meta: { status: patch.status, notes: patch.notes !== undefined },
    outcome: 'ok',
  });
  return ok({ referral: result.referral });
}

export async function adminProcessReferralAsProfessionalService(
  referralId,
  actingUserId,
  actorUser = null,
) {
  if (!mongoose.Types.ObjectId.isValid(referralId)) return fail(400, 'Invalid referral id');
  if (!mongoose.Types.ObjectId.isValid(String(actingUserId || ''))) {
    return fail(400, 'acting_user_id is required');
  }
  const referral = await Referral.findById(referralId);
  if (!referral) return fail(404, 'Referral not found');
  if (String(referral.target_user_id) !== String(actingUserId)) {
    return fail(403, 'Only the target professional can process this referral');
  }
  const result = await processReferralForTarget(referral, actingUserId);
  if (!result.ok) {
    await recordAdminAudit({
      actorUserId: actorId(actorUser),
      onBehalfOfUserId: actingUserId,
      action: 'referral.process_as_professional',
      targetType: 'Referral',
      targetId: referralId,
      outcome: 'error',
      errorMessage: result.message,
    });
    return fail(result.code || 500, result.message || 'Could not process referral');
  }
  await recordAdminAudit({
    actorUserId: actorId(actorUser),
    onBehalfOfUserId: actingUserId,
    action: 'referral.process_as_professional',
    targetType: 'Referral',
    targetId: referralId,
    outcome: 'ok',
  });
  return ok(result);
}

export async function adminReferralLeadDetailsService(referralId, actingUserId) {
  if (!mongoose.Types.ObjectId.isValid(referralId)) return fail(400, 'Invalid referral id');
  if (!mongoose.Types.ObjectId.isValid(String(actingUserId || ''))) {
    return fail(400, 'acting_user_id is required');
  }
  const referral = await Referral.findById(referralId)
    .populate('user_id', 'first_name last_name full_name email role profile_image')
    .populate('target_user_id', 'first_name last_name full_name email role profile_image')
    .lean();
  if (!referral) return fail(404, 'Referral not found');
  const uid = String(actingUserId);
  const isParty =
    String(referral.user_id?._id || referral.user_id) === uid
    || String(referral.target_user_id?._id || referral.target_user_id) === uid;
  if (!isParty) return fail(403, 'Not allowed to view this referral');
  const actingUser = await User.findById(actingUserId).select('role').lean();
  const details = await buildReferralLeadDetailsResponse(
    referral,
    actingUserId,
    actingUser?.role,
  );
  return ok(details);
}

export async function adminCancelLeadCalendlyBookingService(leadId, body = {}, actorUser = null) {
  const loaded = await loadLeadOwner(leadId);
  if (loaded?.status) return loaded;
  const userId = loaded.owner._id;
  const { integ, error } = await loadOwnerCalendlyIntegration(userId);
  if (error) return error;

  const wsAppt = await WorkspaceAppointment.findOne({
    user_id: userId,
    lead_match_id: leadId,
    status: 'booked',
  })
    .sort({ recorded_at: -1 })
    .select('calendly_event_uri calendly_invitee_uri')
    .lean();

  const storedCal = loaded.lead.compatibility_factors?.calendly || {};
  const eventUri = wsAppt?.calendly_event_uri || storedCal.calendly_event_uri;
  const inviteeUri = wsAppt?.calendly_invitee_uri || storedCal.calendly_invitee_uri;

  if (!wsAppt && !storedCal.calendly_event_uri) {
    return fail(400, 'This lead does not have an active booked appointment.');
  }
  if (!eventUri && !inviteeUri) {
    return fail(400, 'No Calendly booking metadata found. Cancel in Calendly directly.');
  }

  const cancelMeta = { calendly_event_uri: eventUri, calendly_invitee_uri: inviteeUri };
  const reason = String(body.reason || '').trim().slice(0, 500);
  let alreadyCanceled = false;
  try {
    const cancelResult = await cancelCalendlyScheduledEvent(
      integ.access_token,
      cancelMeta,
      reason || undefined,
    );
    alreadyCanceled = Boolean(cancelResult?.already_canceled);
  } catch (err) {
    await recordAdminAudit({
      actorUserId: actorId(actorUser),
      onBehalfOfUserId: userId,
      action: 'lead.calendly.cancel',
      targetType: 'LeadMatch',
      targetId: leadId,
      outcome: 'error',
      errorMessage: err?.message,
    });
    return fail(502, err.message || 'Calendly cancel failed');
  }

  // Idempotent: even if Calendly says already canceled, reconcile local state.
  const apply = await applyCalendlyCancellationToLeadForUser(leadId, userId, { payload: storedCal });
  if (!apply.ok) {
    await recordAdminAudit({
      actorUserId: actorId(actorUser),
      onBehalfOfUserId: userId,
      action: 'lead.calendly.cancel',
      targetType: 'LeadMatch',
      targetId: leadId,
      meta: { already_canceled: alreadyCanceled },
      outcome: 'error',
      errorMessage: apply.message,
    });
    return fail(500, apply.message || 'Could not update lead after cancel.');
  }

  const result = ok({
    message: alreadyCanceled
      ? 'Appointment was already canceled in Calendly; local state reconciled.'
      : 'Appointment canceled in Calendly.',
    already_canceled: alreadyCanceled,
  });
  await auditOwnerAction({
    actorUser,
    owner: loaded.owner,
    action: 'lead.calendly.cancel',
    targetType: 'LeadMatch',
    targetId: leadId,
    meta: { already_canceled: alreadyCanceled },
    result,
  });
  return result;
}
