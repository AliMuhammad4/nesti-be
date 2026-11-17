import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { CREDENTIAL_STATUS } from '../../constants/credentialDocuments.js';
import logger from '../../utils/logger.js';
import { dropDuplicateCredentialDocuments } from './credentialDocumentService.js';

let dedupeRan = false;

/**
 * One-time cleanup: profiles saved before uploads replaced by type could hold two documents of
 * the same type. Keeps the newest of each. Safe to run on every boot (a no-op once clean).
 * Disable with CREDENTIAL_DOC_DEDUPE=0|false|off.
 */
export async function dedupeCredentialDocuments({ batchSize = 200 } = {}) {
  const flag = String(process.env.CREDENTIAL_DOC_DEDUPE || '1').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return { removed: 0, skipped: true };
  if (dedupeRan) return { removed: 0 };
  dedupeRan = true;
  let removed = 0;
  try {
    const duplicates = await ProfessionalProfile.aggregate([
      { $match: { 'credential_documents.1': { $exists: true } } },
      { $project: { types: '$credential_documents.type' } },
      { $match: { $expr: { $lt: [{ $size: { $setUnion: ['$types', []] } }, { $size: '$types' }] } } },
      { $project: { _id: 1 } },
    ]);
    for (let i = 0; i < duplicates.length; i += batchSize) {
      const ids = duplicates.slice(i, i + batchSize).map((row) => row._id);
      const profiles = await ProfessionalProfile.find({ _id: { $in: ids } })
        .select('_id user_id credential_documents')
        .lean();
      for (const profile of profiles) removed += await dropDuplicateCredentialDocuments(profile);
    }
    if (removed) logger.info('Credential duplicate cleanup applied', { removed });
    return { removed };
  } catch (error) {
    dedupeRan = false;
    logger.error('Credential duplicate cleanup failed', { error: error?.message });
    throw error;
  }
}

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
