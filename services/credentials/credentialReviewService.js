import mongoose from 'mongoose';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import { USER_ROLE } from '../../constants/roles.js';
import { CREDENTIAL_EVENT_TYPE, CREDENTIAL_STATUS } from '../../constants/credentialDocuments.js';
import { startProfessionalTrialFromApproval } from '../billing/subscriptionLocalService.js';
import { getRequiredCredentialDocs } from './credentialRequirements.js';
import {
  notifyProfessionalCredentialApproved,
  notifyProfessionalCredentialRejected,
} from './credentialNotifications.js';
import { credentialEventPushOp, latestCredentialEventId } from './credentialEvents.js';
import { serializeCredentialStateAsync } from './credentialSerialize.js';
import logger from '../../utils/logger.js';

async function attachEventMeta(profileId, eventId, meta) {
  if (!eventId) return;
  try {
    await ProfessionalProfile.updateOne(
      { _id: profileId, 'credential_events._id': eventId },
      { $set: { 'credential_events.$.meta': meta } },
    );
  } catch (err) {
    logger.warn('Failed to attach credential event meta', { error: err?.message });
  }
}

/** Ids of the files on record (only _id is read). */
async function currentDocumentIds(userId) {
  const current = await ProfessionalProfile.findOne({ user_id: userId }).select('credential_documents._id credential_documents.type').lean();
  return current?.credential_documents || [];
}

/*
 * File statuses are set in the same atomic update as the decision. Saving the whole profile
 * instead re-checked every field, so one older value elsewhere in the profile (for example a
 * since-retired option) failed the save after the status had already changed: the admin got an
 * error, the files kept their old status and the professional was never told.
 */

export async function approveCredentialsService({ userId, adminId, allowMissingDocuments = false }) {
  const now = new Date();
  const current = await ProfessionalProfile.findOne({ user_id: userId })
    .select('professional_type country credential_status credential_documents._id credential_documents.type')
    .lean();
  const hasDocs = (current?.credential_documents || []).length > 0;

  // Approving with required files missing needs an explicit confirmation from the review page.
  if (current?.credential_status === CREDENTIAL_STATUS.PENDING_REVIEW && !allowMissingDocuments) {
    const uploadedTypes = new Set((current.credential_documents || []).map((doc) => String(doc.type || '')));
    const missing = getRequiredCredentialDocs({ role: current.professional_type, country: current.country })
      .filter((item) => item.required && !uploadedTypes.has(item.type));
    if (missing.length) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'REQUIRED_DOCUMENTS_MISSING',
          message: `Required documents are missing: ${missing.map((item) => item.label || item.type).join(', ')}. Open the review page to approve anyway.`,
          missing: missing.map((item) => ({ type: item.type, label: item.label || item.type })),
        },
      };
    }
  }

  const profile = await ProfessionalProfile.findOneAndUpdate(
    { user_id: userId, credential_status: CREDENTIAL_STATUS.PENDING_REVIEW },
    {
      $set: {
        credential_status: CREDENTIAL_STATUS.APPROVED,
        credential_reviewed_at: now,
        credential_reviewed_by: adminId,
        credential_reject_reason: '',
        ...(hasDocs ? { 'credential_documents.$[].status': 'accepted' } : {}),
      },
      $push: {
        credential_events: credentialEventPushOp({
          at: now,
          type: CREDENTIAL_EVENT_TYPE.APPROVED,
          actor_user_id: adminId,
          actor_role: USER_ROLE.ADMIN,
        }),
      },
    },
    { returnDocument: 'after' },
  );

  if (!profile) {
    const existing = await ProfessionalProfile.findOne({ user_id: userId }).select('credential_status').lean();
    if (!existing) {
      return { status: 404, body: { success: false, message: 'Professional profile not found' } };
    }
    return {
      status: 400,
      body: {
        success: false,
        message: `Cannot approve from status "${existing.credential_status}". Expected pending_review.`,
      },
    };
  }

  const approvedEventId = latestCredentialEventId(profile, CREDENTIAL_EVENT_TYPE.APPROVED);

  const proUser = await User.findById(userId);
  if (!proUser) {
    return { status: 404, body: { success: false, message: 'User not found' } };
  }

  const subscription = await startProfessionalTrialFromApproval(userId);

  notifyProfessionalCredentialApproved({ user: proUser, subscription })
    .then((notifyResult) =>
      attachEventMeta(profile._id, approvedEventId, {
        email_meta: notifyResult?.email_meta || null,
        trial_end: subscription?.trial_end || null,
      }),
    )
    .catch((err) => {
      logger.warn('Failed to notify professional of approval', { error: err?.message });
    });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Credentials approved and free trial started',
      credential_status: profile.credential_status,
      trialEndsAt: subscription?.trial_end || null,
      ...(await serializeCredentialStateAsync(profile, proUser.role, { audience: 'admin' })),
    },
  };
}

export async function rejectCredentialsService({ userId, adminId, reason, documentIds = [] }) {
  const rejectReason = String(reason || '').trim();
  if (!rejectReason) {
    return { status: 400, body: { success: false, message: 'Rejection reason is required' } };
  }

  const now = new Date();
  const clippedReason = rejectReason.slice(0, 500);

  // Optional: only these files need a new upload; the rest are kept as accepted.
  // With no files picked, every file needs an update (the earlier behaviour).
  const pickedIds = [...new Set((Array.isArray(documentIds) ? documentIds : []).map(String))];
  const currentDocs = await currentDocumentIds(userId);
  const docsById = new Map(currentDocs.map((doc) => [String(doc._id), doc]));
  if (pickedIds.some((id) => !docsById.has(id))) {
    return { status: 400, body: { success: false, message: 'One of the selected documents is no longer on file. Reload and try again.' } };
  }
  // Every file picked is the same as asking for every file again.
  const everyFilePicked = pickedIds.length > 0 && pickedIds.length === currentDocs.length;
  const pickedTypes = pickedIds.length && !everyFilePicked ? pickedIds.map((id) => docsById.get(id).type) : [];
  const pickedObjectIds = pickedIds.map((id) => new mongoose.Types.ObjectId(id));
  let docStatusSet = {};
  let arrayFilters;
  if (currentDocs.length) {
    if (!pickedIds.length || everyFilePicked) {
      docStatusSet = { 'credential_documents.$[].status': 'rejected' };
    } else {
      docStatusSet = {
        'credential_documents.$[picked].status': 'rejected',
        'credential_documents.$[kept].status': 'accepted',
      };
      arrayFilters = [{ 'picked._id': { $in: pickedObjectIds } }, { 'kept._id': { $nin: pickedObjectIds } }];
    }
  }

  const profile = await ProfessionalProfile.findOneAndUpdate(
    { user_id: userId, credential_status: CREDENTIAL_STATUS.PENDING_REVIEW },
    {
      $set: {
        credential_status: CREDENTIAL_STATUS.REJECTED,
        credential_reviewed_at: now,
        credential_reviewed_by: adminId,
        credential_reject_reason: clippedReason,
        ...docStatusSet,
      },
      $push: {
        credential_events: credentialEventPushOp({
          at: now,
          type: CREDENTIAL_EVENT_TYPE.REJECTED,
          actor_user_id: adminId,
          actor_role: USER_ROLE.ADMIN,
          reason: clippedReason,
          meta: pickedTypes.length ? { needs_update: pickedTypes } : null,
        }),
      },
    },
    { returnDocument: 'after', ...(arrayFilters ? { arrayFilters } : {}) },
  );

  if (!profile) {
    const existing = await ProfessionalProfile.findOne({ user_id: userId }).select('credential_status').lean();
    if (!existing) {
      return { status: 404, body: { success: false, message: 'Professional profile not found' } };
    }
    return {
      status: 400,
      body: {
        success: false,
        message: `Cannot reject from status "${existing.credential_status}". Expected pending_review.`,
      },
    };
  }

  const rejectedEventId = latestCredentialEventId(profile, CREDENTIAL_EVENT_TYPE.REJECTED);

  const proUser = await User.findById(userId);
  if (!proUser) {
    return { status: 404, body: { success: false, message: 'User not found' } };
  }

  notifyProfessionalCredentialRejected({ user: proUser, reason: clippedReason, documentTypes: pickedTypes })
    .then((notifyResult) =>
      attachEventMeta(profile._id, rejectedEventId, {
        ...(pickedTypes.length ? { needs_update: pickedTypes } : {}),
        email_meta: notifyResult?.email_meta || null,
      }),
    )
    .catch((err) => {
      logger.warn('Failed to notify professional of rejection', { error: err?.message });
    });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Credentials rejected',
      ...(await serializeCredentialStateAsync(profile, proUser.role, { audience: 'admin' })),
    },
  };
}
