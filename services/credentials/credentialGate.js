import { isProfessionalRole } from '../../constants/roles.js';
import { CREDENTIAL_STATUS } from '../../constants/credentialDocuments.js';

/** Workspace lock until credentials are admin-approved. */
export function buildCredentialGate(profile, role) {
  if (!isProfessionalRole(role)) {
    return { locked: false, reason: null, status: null };
  }
  const status = String(profile?.credential_status || CREDENTIAL_STATUS.NOT_STARTED);
  if (status === CREDENTIAL_STATUS.APPROVED) {
    return { locked: false, reason: null, status };
  }
  if (status === CREDENTIAL_STATUS.PENDING_REVIEW) {
    return {
      locked: true,
      reason: 'Your credentials are under admin review. You will be notified once approved.',
      status,
    };
  }
  if (status === CREDENTIAL_STATUS.REJECTED) {
    return {
      locked: true,
      reason: profile?.credential_reject_reason
        ? `Verification rejected: ${profile.credential_reject_reason}`
        : 'Verification was rejected. Update your documents and resubmit.',
      status,
    };
  }
  return {
    locked: true,
    reason: 'Upload and submit your professional credentials to start your free trial.',
    status,
  };
}
