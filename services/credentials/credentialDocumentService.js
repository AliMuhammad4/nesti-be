import crypto from 'crypto';
import mongoose from 'mongoose';
import { isProfessionalRole } from '../../constants/roles.js';
import { contentDispositionHeader, safeDownloadName } from '../../utils/fileResponse.js';
import { detectFileType } from '../../utils/fileSignature.js';
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
import { credentialEventPushOp } from './credentialEvents.js';
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

export async function removeStoredCredentialObject(userId, doc) {
  const keys = [
    ownedCredentialObjectKey(userId, doc),
    ownedCredentialObjectKey(userId, { file_key: doc?.thumb_key }),
  ].filter(Boolean);
  await Promise.all(keys.map(async (key) => {
    try {
      await deleteObjectFromR2(key);
    } catch (error) {
      logger.warn('Credential object cleanup failed', { error: error?.message, key });
    }
  }));
}

const CREDENTIAL_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

// The file itself decides its type; the browser-sent type and name are not trusted.
export function detectCredentialFileType(buffer) {
  const detected = detectFileType(buffer);
  return detected && CREDENTIAL_FILE_TYPES.has(detected.mime) ? detected : null;
}

const notProfessionalResponse = () => ({
  status: 403,
  body: { success: false, message: 'Verification is only for professional accounts.' },
});

/*
 * Document list updates use plain $set / $push / $pull operators. Mongoose 9 rejects array
 * ("pipeline") updates unless `updatePipeline: true` is passed, and a pipeline would also read
 * any user text that starts with "$" (a file name, for example) as a field path.
 * Each update returns the profile as it was before, so the caller can delete replaced files.
 */

/** Adds the document, or replaces the existing one of the same type, in one atomic update. */
async function putCredentialDocument(profileId, { statusFilter, newDoc, event, preferReplace }) {
  const base = { _id: profileId, credential_status: statusFilter };
  const eventPush = credentialEventPushOp(event);
  const add = () =>
    ProfessionalProfile.findOneAndUpdate(
      { ...base, 'credential_documents.type': { $ne: newDoc.type } },
      { $push: { credential_documents: newDoc, credential_events: eventPush } },
      { returnDocument: 'before' },
    );
  const replace = () =>
    ProfessionalProfile.findOneAndUpdate(
      { ...base, 'credential_documents.type': newDoc.type },
      {
        $set: { 'credential_documents.$[same]': newDoc },
        $push: { credential_events: eventPush },
      },
      { returnDocument: 'before', arrayFilters: [{ 'same.type': newDoc.type }] },
    );
  // Try the likely case first; if another request changed the list meanwhile, try the other.
  const [first, second] = preferReplace ? [replace, add] : [add, replace];
  return (await first()) || (await second());
}

/** Drops one document by id. */
function pullCredentialDocument(profileId, { statusFilter, docId, event }) {
  return ProfessionalProfile.findOneAndUpdate(
    { _id: profileId, credential_status: statusFilter, 'credential_documents._id': docId },
    {
      $pull: { credential_documents: { _id: docId } },
      $push: { credential_events: credentialEventPushOp(event) },
    },
    { returnDocument: 'before' },
  );
}

const docTime = (doc) => {
  const uploaded = doc?.uploaded_at ? new Date(doc.uploaded_at).getTime() : NaN;
  if (Number.isFinite(uploaded)) return uploaded;
  try {
    return new mongoose.Types.ObjectId(String(doc?._id)).getTimestamp().getTime();
  } catch {
    return 0;
  }
};

/**
 * Older profiles can hold two documents of the same type. Keeps the newest of each type and
 * drops the rest (and their stored files). Only applies if the list is still exactly as read.
 */
export async function dropDuplicateCredentialDocuments(profile) {
  const docs = profile?.credential_documents || [];
  const newestByType = new Map();
  for (const doc of docs) {
    const type = String(doc?.type || '');
    const kept = newestByType.get(type);
    if (!kept || docTime(doc) > docTime(kept)) newestByType.set(type, doc);
  }
  const dropped = docs.filter((doc) => newestByType.get(String(doc?.type || '')) !== doc);
  if (!dropped.length) return 0;
  const result = await ProfessionalProfile.updateOne(
    {
      _id: profile._id,
      credential_documents: { $size: docs.length },
      'credential_documents._id': { $all: docs.map((doc) => doc._id) },
    },
    { $pull: { credential_documents: { _id: { $in: dropped.map((doc) => doc._id) } } } },
  );
  if (!result.modifiedCount) return 0;
  await Promise.all(dropped.map((doc) => removeStoredCredentialObject(profile.user_id, doc)));
  logger.info('Removed duplicate credential documents', { profileId: String(profile._id), count: dropped.length });
  return dropped.length;
}

/** A first upload moves a not-started profile to "documents needed"; other statuses stay. */
async function promoteToPendingDocs(profileId) {
  await ProfessionalProfile.updateOne(
    { _id: profileId, credential_status: { $in: [null, '', CREDENTIAL_STATUS.NOT_STARTED] } },
    { $set: { credential_status: CREDENTIAL_STATUS.PENDING_DOCS } },
  );
}

// Card previews ask for ?thumb=1: a small WebP instead of the full phone photo (often 3-8 MB).
const THUMB_MAX_PX = 360;
const THUMB_CACHE_MAX = 200;
const thumbCache = new Map();
const thumbJobs = new Map();

function thumbCacheKey(doc) {
  const at = doc?.uploaded_at ? new Date(doc.uploaded_at).getTime() : 0;
  return `${String(doc?._id || '')}|${at}|${String(doc?.file_key || '')}`;
}

function isImageDocument(doc) {
  const mime = String(doc?.mime_type || '').toLowerCase();
  return mime.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(String(doc?.file_name || ''));
}

async function makeThumbnail(buffer) {
  const sharp = (await import('sharp')).default;
  return sharp(buffer, { failOn: 'none', sequentialRead: true, limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: THUMB_MAX_PX,
      height: THUMB_MAX_PX,
      fit: 'inside',
      withoutEnlargement: true,
      fastShrinkOnLoad: true,
    })
    .webp({ quality: 60, effort: 1 })
    .toBuffer();
}

function rememberThumbnail(cacheKey, buffer) {
  if (!cacheKey || !buffer) return;
  thumbCache.delete(cacheKey);
  thumbCache.set(cacheKey, buffer);
  while (thumbCache.size > THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value);
}

function previewObjectKey(objectKey) {
  return `${objectKey}.preview.webp`;
}

async function persistCredentialThumbnail({ userId, profileId, docId, objectKey, buffer, cacheKey }) {
  const small = await makeThumbnail(buffer);
  rememberThumbnail(cacheKey, small);
  const thumbKey = previewObjectKey(objectKey);
  if (!ownedCredentialObjectKey(userId, { file_key: thumbKey })) return small;
  await uploadBufferToR2(small, {
    key: thumbKey,
    mimeType: 'image/webp',
    cacheControl: 'private, max-age=86400',
  });
  if (profileId && docId) {
    await ProfessionalProfile.updateOne(
      { _id: profileId, 'credential_documents._id': docId },
      { $set: { 'credential_documents.$.thumb_key': thumbKey } },
    );
  }
  return small;
}

function scheduleCredentialThumbnail(args) {
  const cacheKey = args.cacheKey || thumbCacheKey({ _id: args.docId, file_key: args.objectKey });
  if (thumbJobs.has(cacheKey)) return thumbJobs.get(cacheKey);
  const job = persistCredentialThumbnail({ ...args, cacheKey })
    .catch((error) => {
      logger.warn('Credential thumbnail save failed', { error: error?.message, docId: String(args.docId || '') });
      return null;
    })
    .finally(() => thumbJobs.delete(cacheKey));
  thumbJobs.set(cacheKey, job);
  return job;
}

function sendThumbnail(doc, buffer) {
  return {
    status: 200,
    file: {
      buffer,
      contentType: 'image/webp',
      fileName: `${safeDownloadName(doc.file_name, 'preview').replace(/\.[^.]+$/, '')}-preview.webp`,
      contentLength: buffer.length,
      // The URL carries the upload time, so a replaced file gets a new URL.
      cacheControl: 'private, max-age=86400',
    },
  };
}

function sendCredentialFile(doc, object) {
  const fileName = safeDownloadName(doc.file_name, `${doc.type || 'document'}`);
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

export async function loadCredentialDocumentFile({ userId, docId, thumb = false }) {
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

  const wantThumb = Boolean(thumb) && isImageDocument(doc);
  const cacheKey = wantThumb ? thumbCacheKey(doc) : '';
  if (wantThumb && thumbCache.has(cacheKey)) {
    const cached = thumbCache.get(cacheKey);
    thumbCache.delete(cacheKey);
    thumbCache.set(cacheKey, cached);
    return sendThumbnail(doc, cached);
  }

  const storedThumbKey = wantThumb ? String(doc.thumb_key || '').trim() : '';
  if (storedThumbKey && ownedCredentialObjectKey(userId, { file_key: storedThumbKey })) {
    try {
      const stored = await getObjectFromR2(storedThumbKey);
      if (stored?.buffer?.length) {
        rememberThumbnail(cacheKey, stored.buffer);
        return sendThumbnail(doc, stored.buffer);
      }
    } catch (error) {
      logger.warn('Stored credential thumbnail missing; rebuilding', { error: error?.message, docId: String(docId) });
    }
  }

  try {
    const object = await getObjectFromR2(objectKey);
    if (wantThumb) {
      try {
        const pending = thumbJobs.get(cacheKey);
        const small = pending
          ? await pending
          : await scheduleCredentialThumbnail({
            userId,
            profileId: profile._id,
            docId: doc._id,
            objectKey,
            buffer: object.buffer,
            cacheKey,
          });
        if (small?.length) return sendThumbnail(doc, small);
      } catch (error) {
        // An image sharp can't read still shows, just at full size.
        logger.warn('Credential thumbnail failed; sending original', { error: error?.message, docId: String(docId) });
      }
    }
    return sendCredentialFile(doc, object);
  } catch (error) {
    logger.warn('Credential document read failed', { error: error?.message, docId: String(docId) });
    return {
      status: 502,
      body: { success: false, message: 'Could not load this document. Please try again.' },
    };
  }
}

export async function getMyCredentialDocumentService(user, docId, { thumb = false } = {}) {
  if (!isProfessionalRole(user?.role)) return notProfessionalResponse();
  return loadCredentialDocumentFile({ userId: user._id, docId, thumb });
}

export async function uploadCredentialDocumentService(user, { type, file }) {
  if (!isProfessionalRole(user?.role)) return notProfessionalResponse();
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
  const detected = detectCredentialFileType(file.buffer);
  if (!detected) {
    return {
      status: 400,
      body: { success: false, message: 'This file is not a real JPEG, PNG, WEBP or PDF. Please upload the original file.' },
    };
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

  // Unguessable key: ID documents must not be reachable by guessing a storage address.
  const objectKey = `${credentialKeyPrefix(user._id)}${docType}-${crypto.randomBytes(16).toString('hex')}.${detected.ext}`;
  const fileName = safeDownloadName(file.originalname, `${docType}.${detected.ext}`);
  const result = await uploadBufferToR2(file.buffer, {
    key: objectKey,
    mimeType: detected.mime,
    cacheControl: 'private, no-store',
    contentDisposition: contentDispositionHeader('inline', fileName),
  });
  const newDocKey = result.key || objectKey;

  const newDoc = {
    _id: new mongoose.Types.ObjectId(),
    type: docType,
    file_url: result.secure_url || result.url || newDocKey,
    file_key: newDocKey,
    file_name: fileName,
    mime_type: detected.mime,
    uploaded_at: new Date(),
    status: 'uploaded',
  };

  const sameType = (profile.credential_documents || []).filter((doc) => String(doc.type) === docType);
  if (sameType.length > 1) await dropDuplicateCredentialDocuments(profile);

  let before;
  try {
    before = await putCredentialDocument(profile._id, {
      statusFilter: { $nin: [CREDENTIAL_STATUS.PENDING_REVIEW, CREDENTIAL_STATUS.APPROVED] },
      newDoc,
      preferReplace: (profile.credential_documents || []).some((doc) => String(doc.type) === docType),
      event: {
        type: CREDENTIAL_EVENT_TYPE.DOC_UPLOADED,
        actor_user_id: user._id,
        actor_role: user.role,
        meta: { doc_type: docType, file_name: fileName },
      },
    });
    if (before) await promoteToPendingDocs(profile._id);
  } catch (error) {
    await removeStoredCredentialObject(user._id, { file_key: newDocKey });
    throw error;
  }

  if (!before) {
    await removeStoredCredentialObject(user._id, { file_key: newDocKey });
    const current = await ProfessionalProfile.findById(profile._id).select('credential_status');
    if (current?.credential_status === CREDENTIAL_STATUS.PENDING_REVIEW) {
      return {
        status: 400,
        body: { success: false, message: 'Credentials are under review. Wait for a decision before uploading.' },
      };
    }
    if (current?.credential_status === CREDENTIAL_STATUS.APPROVED) {
      return { status: 400, body: { success: false, message: 'Credentials are already approved.' } };
    }
    return { status: 409, body: { success: false, message: 'Your documents changed at the same time. Please try again.' } };
  }

  const replaced = (before.credential_documents || []).filter((doc) => String(doc.type) === docType);
  await Promise.all(replaced.map((doc) => removeStoredCredentialObject(user._id, doc)));

  if (detected.mime.startsWith('image/')) {
    scheduleCredentialThumbnail({
      userId: user._id,
      profileId: profile._id,
      docId: newDoc._id,
      objectKey: newDocKey,
      buffer: file.buffer,
      cacheKey: thumbCacheKey(newDoc),
    });
  }

  const saved = await ProfessionalProfile.findById(profile._id);
  return {
    status: 200,
    body: {
      success: true,
      message: 'Document uploaded',
      ...(await serializeCredentialStateAsync(saved, user.role)),
    },
  };
}

export async function deleteCredentialDocumentService(user, docId) {
  if (!isProfessionalRole(user?.role)) return notProfessionalResponse();
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

  const removed = (profile.credential_documents || []).find((doc) => String(doc._id) === String(docId));
  if (!removed) {
    return { status: 404, body: { success: false, message: 'Document not found' } };
  }

  const before = await pullCredentialDocument(profile._id, {
    statusFilter: { $nin: [CREDENTIAL_STATUS.PENDING_REVIEW, CREDENTIAL_STATUS.APPROVED] },
    docId: removed._id,
    event: {
      type: CREDENTIAL_EVENT_TYPE.DOC_DELETED,
      actor_user_id: user._id,
      actor_role: user.role,
      meta: { doc_type: removed?.type || null, doc_id: String(docId) },
    },
  });
  if (!before) {
    const current = await ProfessionalProfile.findById(profile._id).select('credential_status').lean();
    if (![CREDENTIAL_STATUS.PENDING_REVIEW, CREDENTIAL_STATUS.APPROVED].includes(current?.credential_status)) {
      // Removed by another request (another tab) in the meantime.
      return { status: 404, body: { success: false, message: 'Document not found' } };
    }
    return {
      status: 400,
      body: { success: false, message: 'Documents cannot be deleted in the current verification state.' },
    };
  }

  const deleted = (before.credential_documents || []).find((doc) => String(doc._id) === String(docId));
  if (deleted) await removeStoredCredentialObject(user._id, deleted);

  const saved = await ProfessionalProfile.findById(profile._id);
  return {
    status: 200,
    body: { success: true, ...(await serializeCredentialStateAsync(saved, user.role)) },
  };
}
