import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import { USER_ROLE } from '../../constants/roles.js';
import { CREDENTIAL_EVENT_TYPE, CREDENTIAL_STATUS } from '../../constants/credentialDocuments.js';
import { startProfessionalTrialFromApproval } from '../billing/subscriptionLocalService.js';
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

export async function approveCredentialsService({ userId, adminId }) {
  const now = new Date();

  const profile = await ProfessionalProfile.findOneAndUpdate(
    { user_id: userId, credential_status: CREDENTIAL_STATUS.PENDING_REVIEW },
    {
      $set: {
        credential_status: CREDENTIAL_STATUS.APPROVED,
        credential_reviewed_at: now,
        credential_reviewed_by: adminId,
        credential_reject_reason: '',
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
    { new: true },
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

  if (Array.isArray(profile.credential_documents) && profile.credential_documents.length) {
    profile.credential_documents.forEach((doc) => {
      doc.status = 'accepted';
    });
    await profile.save();
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

export async function rejectCredentialsService({ userId, adminId, reason }) {
  const rejectReason = String(reason || '').trim();
  if (!rejectReason) {
    return { status: 400, body: { success: false, message: 'Rejection reason is required' } };
  }

  const now = new Date();
  const clippedReason = rejectReason.slice(0, 500);

  const profile = await ProfessionalProfile.findOneAndUpdate(
    { user_id: userId, credential_status: CREDENTIAL_STATUS.PENDING_REVIEW },
    {
      $set: {
        credential_status: CREDENTIAL_STATUS.REJECTED,
        credential_reviewed_at: now,
        credential_reviewed_by: adminId,
        credential_reject_reason: clippedReason,
      },
      $push: {
        credential_events: credentialEventPushOp({
          at: now,
          type: CREDENTIAL_EVENT_TYPE.REJECTED,
          actor_user_id: adminId,
          actor_role: USER_ROLE.ADMIN,
          reason: clippedReason,
        }),
      },
    },
    { new: true },
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

  if (Array.isArray(profile.credential_documents) && profile.credential_documents.length) {
    profile.credential_documents.forEach((doc) => {
      doc.status = 'rejected';
    });
    await profile.save();
  }

  const proUser = await User.findById(userId);
  if (!proUser) {
    return { status: 404, body: { success: false, message: 'User not found' } };
  }

  notifyProfessionalCredentialRejected({ user: proUser, reason: clippedReason })
    .then((notifyResult) =>
      attachEventMeta(profile._id, rejectedEventId, {
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
