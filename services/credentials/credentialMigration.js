import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { CREDENTIAL_STATUS } from '../../constants/credentialDocuments.js';
import logger from '../../utils/logger.js';

let grandfatherRan = false;

/**
 * One-time bootstrap for profiles created before credential_status existed.
 * Safe to run on every boot: once all rows have a status it matches 0 and is a no-op.
 *
 * Not required for new installs. Disable with CREDENTIAL_GRANDFATHER=0|false|off.
 */
export async function grandfatherExistingCredentials() {
  const flag = String(process.env.CREDENTIAL_GRANDFATHER || '1').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return { matched: 0, skipped: true };
  }
  if (grandfatherRan) return { matched: 0 };
  grandfatherRan = true;
  try {
    const result = await ProfessionalProfile.updateMany(
      {
        $or: [
          { credential_status: { $exists: false } },
          { credential_status: null },
          { credential_status: '' },
        ],
      },
      {
        $set: {
          credential_status: CREDENTIAL_STATUS.APPROVED,
          credential_reviewed_at: new Date(),
          credential_reject_reason: '',
        },
      },
    );
    const matched = result.matchedCount ?? result.n ?? 0;
    const modified = result.modifiedCount ?? result.nModified ?? 0;
    if (matched > 0) {
      logger.info('Credential grandfather migration applied', { matched, modified });
    }
    return result;
  } catch (error) {
    grandfatherRan = false;
    logger.error('Credential grandfather migration failed', { error: error?.message });
    throw error;
  }
}
