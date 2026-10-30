import mongoose from 'mongoose';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import {
  CREDENTIAL_DOC_TYPE_VALUES,
  CREDENTIAL_EVENT_TYPE,
  CREDENTIAL_STATUS,
} from '../../constants/credentialDocuments.js';
import {
  deleteObjectFromR2,
  extractR2KeyFromPublicUrl,
  getObjectFromR2,
  isR2Configured,
  uploadBufferToR2,
} from '../media/r2Client.js';
import { pushCredentialEvent } from './credentialEvents.js';
import { serializeCredentialStateAsync } from './credentialSerialize.js';
import logger from '../../utils/logger.js';

function credentialKeyPrefix(userId) {
  return `nesti/users/${String(userId)}/credentials/`;
}

/** Only delete objects this professional actually owns under the credentials prefix. */
export function ownedCredentialObjectKey(userId, doc) {
  const fromKey = String(doc?.file_key || '').trim();
  const fromUrl = extractR2KeyFromPublicUrl(doc?.file_url);
  const key = fromKey || fromUrl || '';
  if (!key) return null;
  if (!key.startsWith(credentialKeyPrefix(userId))) return null;
  return key;
}

async function removeStoredCredentialObject(userId, doc) {
  const key = ownedCredentialObjectKey(userId, doc);
  if (!key) return;
  try {
    await deleteObjectFromR2(key);
  } catch (error) {
    logger.warn('Credential object cleanup failed', { error: error?.message, key });
  }
}

function sendCredentialFile(doc, object) {
  const fileName = String(doc.file_name || `${doc.type || 'document'}.bin`).replace(/"/g, '');
  const contentType =
    doc.mime_type
    || object.contentType
    || (/\.pdf$/i.test(fileName) ? 'application/pdf' : 'application/octet-stream');
  return {
    status: 200,
    file: {
      buffer: object.buffer,
      contentType,
      fileName,
      contentLength: object.contentLength,
    },
  };
}

export async function loadCredentialDocumentFile({ userId, docId }) {
  if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(docId)) {
    return { status: 400, body: { success: false, message: 'Invalid id' } };
  }
  if (!isR2Configured()) {
    return { status: 503, body: { success: false, message: 'Document storage is not configured' } };
  }

  const profile = await ProfessionalProfile.findOne({ user_id: userId });
  if (!profile) {
    return { status: 404, body: { success: false, message: 'Verification record not found' } };
  }

  const doc = (profile.credential_documents || []).find((item) => String(item._id) === String(docId));
  if (!doc) {
    return { status: 404, body: { success: false, message: 'Document not found' } };
  }

  const objectKey =
    String(doc.file_key || '').trim() || extractR2KeyFromPublicUrl(doc.file_url);
  if (!objectKey) {
    return { status: 404, body: { success: false, message: 'Document storage key not found' } };
  }

  try {
    const object = await getObjectFromR2(objectKey);
    return sendCredentialFile(doc, object);
  } catch (error) {
    return {
      status: 502,
      body: { success: false, message: error?.message || 'Failed to load document from storage' },
    };
  }
}

export async function getMyCredentialDocumentService(user, docId) {
  return loadCredentialDocumentFile({ userId: user._id, docId });
}

export async function uploadCredentialDocumentService(user, { type, file }) {
  if (!isR2Configured()) {
    return {
      status: 503,
      body: { success: false, message: 'Document upload is not configured (missing R2 environment variables).' },
    };
  }
  const docType = String(type || '').trim();
  if (!CREDENTIAL_DOC_TYPE_VALUES.includes(docType)) {
    return { status: 400, body: { success: false, message: 'Invalid document type' } };
  }
  if (!file?.buffer) {
    return { status: 400, body: { success: false, message: 'Missing file (field name: file)' } };
  }

  const profile = await ProfessionalProfile.findOne({ user_id: user._id });
  if (!profile) {
    return { status: 404, body: { success: false, message: 'Professional profile not found' } };
  }
  if (profile.credential_status === CREDENTIAL_STATUS.PENDING_REVIEW) {
    return {
      status: 400,
      body: { success: false, message: 'Credentials are under review. Wait for a decision before uploading.' },
    };
  }
  if (profile.credential_status === CREDENTIAL_STATUS.APPROVED) {
    return { status: 400, body: { success: false, message: 'Credentials are already approved.' } };
  }

  const previous = (profile.credential_documents || []).filter(
    (doc) => String(doc.type) === docType,
  );

  const uploadVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const objectKey = `${credentialKeyPrefix(user._id)}${docType}-${uploadVersion}`;
  const isPdf = String(file.mimetype || '').toLowerCase().includes('pdf')
    || /\.pdf$/i.test(String(file.originalname || ''));
  const result = await uploadBufferToR2(file.buffer, {
    key: objectKey,
    mimeType: file.mimetype || (isPdf ? 'application/pdf' : undefined),
    cacheControl: 'private, max-age=3600',
    contentDisposition: isPdf
      ? `inline; filename="${String(file.originalname || `${docType}.pdf`).replace(/"/g, '')}"`
      : undefined,
  });

  profile.credential_documents = (profile.credential_documents || []).filter(
    (doc) => String(doc.type) !== docType,
  );
  profile.credential_documents.push({
    type: docType,
    file_url: result.secure_url || result.url,
    file_key: result.key || objectKey,
    file_name: file.originalname || `${docType}.bin`,
    mime_type: file.mimetype || '',
    uploaded_at: new Date(),
    status: 'uploaded',
  });

  // A rejected profile stays rejected until it is resubmitted, so the professional
  // keeps seeing the reject reason while swapping files and the resubmission is
  // still recorded as a resubmit rather than a first-time submit.
  if (
    !profile.credential_status
    || profile.credential_status === CREDENTIAL_STATUS.NOT_STARTED
  ) {
    profile.credential_status = CREDENTIAL_STATUS.PENDING_DOCS;
  }

  pushCredentialEvent(profile, {
    type: CREDENTIAL_EVENT_TYPE.DOC_UPLOADED,
    actor_user_id: user._id,
    actor_role: user.role,
    meta: { doc_type: docType, file_name: file.originalname || '' },
  });

  await profile.save();
  await Promise.all(previous.map((doc) => removeStoredCredentialObject(user._id, doc)));

  return {
    status: 200,
    body: {
      success: true,
      message: 'Document uploaded',
      ...(await serializeCredentialStateAsync(profile, user.role)),
    },
  };
}

export async function deleteCredentialDocumentService(user, docId) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id });
  if (!profile) {
    return { status: 404, body: { success: false, message: 'Professional profile not found' } };
  }
  if ([CREDENTIAL_STATUS.PENDING_REVIEW, CREDENTIAL_STATUS.APPROVED].includes(profile.credential_status)) {
    return {
      status: 400,
      body: { success: false, message: 'Documents cannot be deleted in the current verification state.' },
    };
  }

  const documents = profile.credential_documents || [];
  const removed = documents.find((doc) => String(doc._id) === String(docId));
  if (!removed) {
    return { status: 404, body: { success: false, message: 'Document not found' } };
  }
  profile.credential_documents = documents.filter((doc) => String(doc._id) !== String(docId));

  pushCredentialEvent(profile, {
    type: CREDENTIAL_EVENT_TYPE.DOC_DELETED,
    actor_user_id: user._id,
    actor_role: user.role,
    meta: { doc_type: removed?.type || null, doc_id: String(docId) },
  });

  await profile.save();
  await removeStoredCredentialObject(user._id, removed);

  return {
    status: 200,
    body: { success: true, ...(await serializeCredentialStateAsync(profile, user.role)) },
  };
}
