import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { isProfessionalRole, USER_ROLE } from '../../constants/roles.js';
import {
  CREDENTIAL_COUNTRY_VALUES,
  CREDENTIAL_DOC_TYPE_VALUES,
  CREDENTIAL_EVENT_TYPE,
  CREDENTIAL_STATUS,
  CREDENTIAL_STATUS_VALUES,
} from '../../constants/credentialDocuments.js';
import { getRequiredCredentialDocTypes } from './credentialRequirements.js';
import {
  notifyAdminsCredentialSubmitted,
  notifyAdminsProfessionalSignup,
} from './credentialNotifications.js';
import { latestCredentialEventId, pushCredentialEvent } from './credentialEvents.js';
import { serializeCredentialStateAsync } from './credentialSerialize.js';
import logger from '../../utils/logger.js';

export async function getMyCredentialsService(user) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id });
  if (!profile) {
    return { status: 404, body: { success: false, message: 'Professional profile not found' } };
  }
  return {
    status: 200,
    body: {
      success: true,
      ...(await serializeCredentialStateAsync(profile, user.role)),
      countries: CREDENTIAL_COUNTRY_VALUES,
      statuses: CREDENTIAL_STATUS_VALUES,
      doc_types: CREDENTIAL_DOC_TYPE_VALUES,
    },
  };
}

export async function updateCredentialMetaService(user, payload = {}) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id });
  if (!profile) {
    return { status: 404, body: { success: false, message: 'Professional profile not found' } };
  }
  if (profile.credential_status === CREDENTIAL_STATUS.PENDING_REVIEW) {
    return {
      status: 400,
      body: { success: false, message: 'Credentials are under review and cannot be edited until a decision is made.' },
    };
  }
  if (profile.credential_status === CREDENTIAL_STATUS.APPROVED) {
    return {
      status: 400,
      body: { success: false, message: 'Credentials are already approved.' },
    };
  }

  if (payload.country !== undefined) {
    const country = String(payload.country || '').trim().toUpperCase();
    if (country && !CREDENTIAL_COUNTRY_VALUES.includes(country)) {
      return { status: 400, body: { success: false, message: 'country must be CA or US' } };
    }
    profile.country = country || null;
  }
  if (payload.jurisdiction !== undefined) {
    profile.jurisdiction = String(payload.jurisdiction || '').trim().toUpperCase().slice(0, 12);
  }
  if (payload.nmls_id !== undefined) {
    profile.nmls_id = String(payload.nmls_id || '').trim().slice(0, 40);
  }
  if (payload.license_number !== undefined) {
    profile.license_number = String(payload.license_number || '').trim().slice(0, 80);
  }
  if (payload.company_name !== undefined) {
    profile.company_name = String(payload.company_name || '').trim().slice(0, 160);
  }

  if (
    !profile.credential_status
    || profile.credential_status === CREDENTIAL_STATUS.NOT_STARTED
  ) {
    profile.credential_status = CREDENTIAL_STATUS.PENDING_DOCS;
  }

  await profile.save();
  return {
    status: 200,
    body: { success: true, ...(await serializeCredentialStateAsync(profile, user.role)) },
  };
}

export async function submitCredentialsService(user) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id });
  if (!profile) {
    return { status: 404, body: { success: false, message: 'Professional profile not found' } };
  }
  if (profile.credential_status === CREDENTIAL_STATUS.APPROVED) {
    return { status: 400, body: { success: false, message: 'Credentials are already approved.' } };
  }
  if (profile.credential_status === CREDENTIAL_STATUS.PENDING_REVIEW) {
    return { status: 400, body: { success: false, message: 'Credentials are already under review.' } };
  }

  const country = String(profile.country || '').trim().toUpperCase();
  if (!CREDENTIAL_COUNTRY_VALUES.includes(country)) {
    return { status: 400, body: { success: false, message: 'Select country (CA or US) before submitting.' } };
  }
  if (!String(profile.jurisdiction || '').trim()) {
    return { status: 400, body: { success: false, message: 'Select province/state before submitting.' } };
  }
  if (!String(profile.license_number || '').trim()) {
    return { status: 400, body: { success: false, message: 'License / registration number is required.' } };
  }
  if (!String(profile.company_name || '').trim()) {
    return { status: 400, body: { success: false, message: 'Company / brokerage / firm name is required.' } };
  }
  if (
    String(profile.professional_type || user.role) === USER_ROLE.MORTGAGE_BROKER
    && country === 'US'
    && !String(profile.nmls_id || '').trim()
  ) {
    return { status: 400, body: { success: false, message: 'NMLS ID is required for US mortgage brokers.' } };
  }

  const requiredTypes = getRequiredCredentialDocTypes({
    role: profile.professional_type || user.role,
    country,
  });
  const uploaded = new Set((profile.credential_documents || []).map((d) => d.type));
  const missing = requiredTypes.filter((type) => !uploaded.has(type));
  if (missing.length) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Missing required documents',
        missing,
      },
    };
  }

  const needsReplace = requiredTypes.filter((type) => {
    const doc = (profile.credential_documents || []).find((item) => String(item.type) === type);
    return doc && String(doc.status || '') === 'rejected';
  });
  if (needsReplace.length) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Replace rejected documents before resubmitting.',
        missing: needsReplace,
      },
    };
  }

  const wasRejected = profile.credential_status === CREDENTIAL_STATUS.REJECTED;
  const now = new Date();
  profile.credential_status = CREDENTIAL_STATUS.PENDING_REVIEW;
  profile.credential_submitted_at = now;
  profile.credential_reject_reason = '';
  profile.credential_reviewed_at = null;
  profile.credential_reviewed_by = null;

  pushCredentialEvent(profile, {
    type: wasRejected ? CREDENTIAL_EVENT_TYPE.RESUBMITTED : CREDENTIAL_EVENT_TYPE.SUBMITTED,
    actor_user_id: user._id,
    actor_role: user.role,
    meta: {
      country: profile.country,
      jurisdiction: profile.jurisdiction,
      document_count: (profile.credential_documents || []).length,
    },
  });

  await profile.save();

  const submitType = wasRejected ? CREDENTIAL_EVENT_TYPE.RESUBMITTED : CREDENTIAL_EVENT_TYPE.SUBMITTED;
  const submitEventId = latestCredentialEventId(profile, submitType);
  notifyAdminsCredentialSubmitted({ user, profile })
    .then(async (notifyResult) => {
      if (!submitEventId) return;
      try {
        await ProfessionalProfile.updateOne(
          { _id: profile._id, 'credential_events._id': submitEventId },
          {
            $set: {
              'credential_events.$.meta.email_results': notifyResult?.email_results || [],
            },
          },
        );
      } catch (err) {
        logger.warn('Failed to attach email meta to submit event', { error: err?.message });
      }
    })
    .catch((err) => {
      logger.warn('Failed to notify admins of credential submit', { error: err?.message });
    });

  return {
    status: 200,
    body: {
      success: true,
      message: wasRejected
        ? 'Credentials resubmitted for admin review'
        : 'Credentials submitted for admin review',
      ...(await serializeCredentialStateAsync(profile, user.role)),
    },
  };
}

export async function notifySignupAwaitingDocs(user) {
  if (!isProfessionalRole(user?.role)) return;
  notifyAdminsProfessionalSignup({ user }).catch((err) => {
    logger.warn('Failed to notify admins of professional signup', { error: err?.message });
  });
}
