import crypto from 'node:crypto';
import mongoose from 'mongoose';
import LeadDocument from '../../../models/LeadDocument.js';
import LeadMatch from '../../../models/LeadMatch.js';
import { createSignedReadUrl, deleteObjectFromR2, uploadBufferToR2 } from '../../media/r2Client.js';
import {
  MIME_BY_KIND,
  assertChatDocumentLimits,
  sniffChatFile,
} from './documentFileKind.js';
import { readChatDocument } from './documentReadJobs.js';

const MAX_FILES_PER_CONVERSATION = 10;

export async function countConversationDocuments({ userId, sessionId, conversationId }) {
  return LeadDocument.countDocuments({
    user_id: userId,
    $or: [
      conversationId ? { conversation_id: conversationId } : null,
      sessionId ? { session_id: sessionId } : null,
    ].filter(Boolean),
  });
}

async function findSameChatDocument({ userId, sessionId, conversationId, preview, filename, bytes, contentHash }) {
  const scope = [
    conversationId ? { conversation_id: conversationId } : null,
    sessionId ? { session_id: sessionId } : null,
  ].filter(Boolean);
  if (!scope.length || !contentHash) return null;
  const previewFilter = preview === true ? true : { $ne: true };
  const hashed = await LeadDocument.findOne({
    user_id: userId,
    preview: previewFilter,
    content_hash: contentHash,
    $or: scope,
  }).select('_id').lean();
  if (hashed) return hashed;
  const name = String(filename || 'document').slice(0, 180);
  if (!name || !bytes) return null;
  return LeadDocument.findOne({
    user_id: userId,
    preview: previewFilter,
    original_filename: name,
    bytes,
    $and: [
      { $or: scope },
      { $or: [{ content_hash: '' }, { content_hash: null }, { content_hash: { $exists: false } }] },
    ],
  }).select('_id').lean();
}

export async function saveChatDocument({
  userId,
  sessionId,
  conversationId = null,
  buffer,
  filename,
  declaredMime,
  preview = false,
}) {
  const sniffed = sniffChatFile(buffer, declaredMime, filename);
  if (!sniffed.ok) {
    const error = new Error(sniffed.reason);
    error.status = 400;
    throw error;
  }
  const count = await countConversationDocuments({ userId, sessionId, conversationId });
  if (count >= MAX_FILES_PER_CONVERSATION) {
    const error = new Error('This conversation already has 10 files.');
    error.status = 400;
    throw error;
  }
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const already = await findSameChatDocument({
    userId,
    sessionId,
    conversationId,
    preview,
    filename,
    bytes: buffer.length,
    contentHash: hash,
  });
  if (already) {
    const error = new Error('You already uploaded this file.');
    error.status = 409;
    throw error;
  }
  await assertChatDocumentLimits(buffer, sniffed.kind);
  const ext = sniffed.kind === 'pdf' ? '.pdf' : sniffed.kind === 'word' ? (sniffed.mime === MIME_BY_KIND.doc ? '.doc' : '.docx') : sniffed.mime === MIME_BY_KIND.png ? '.png' : sniffed.mime === MIME_BY_KIND.webp ? '.webp' : sniffed.mime === MIME_BY_KIND.heic ? '.heic' : '.jpg';
  const key = `nesti/chatbot/${userId}/${sessionId || 'session'}/${crypto.randomBytes(8).toString('hex')}${ext}`;
  await uploadBufferToR2(buffer, {
    key,
    mimeType: sniffed.mime,
    cacheControl: 'private, no-store',
    contentDisposition: 'inline',
  });
  const doc = await LeadDocument.create({
    user_id: userId,
    conversation_id: conversationId,
    session_id: sessionId || '',
    original_filename: String(filename || 'document').slice(0, 180),
    mime_type: sniffed.mime,
    bytes: buffer.length,
    content_hash: hash,
    kind: sniffed.kind,
    r2_key: key,
    status: 'uploaded',
    preview: preview === true,
  });
  void readChatDocument(doc._id);
  return doc;
}

export async function signStoredAttachments(attachments = []) {
  const rows = Array.isArray(attachments) ? attachments : [];
  const ids = rows.map((file) => String(file?.id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id));
  const docs = ids.length
    ? await LeadDocument.find({ _id: { $in: ids } }).select('r2_key original_filename mime_type').lean()
    : [];
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  return Promise.all(rows.map(async (file) => {
    const doc = byId.get(String(file?.id || ''));
    if (!doc?.r2_key) return file;
    try {
      const openUrl = await createSignedReadUrl(doc.r2_key, {
        expiresIn: 10 * 60,
        download: false,
        filename: doc.original_filename || file.original_filename,
        responseContentType: doc.mime_type || file.mime_type,
      });
      return { ...file, open_url: openUrl };
    } catch {
      return file;
    }
  }));
}

export async function publicDocumentView(doc) {
  const sign = (download) => createSignedReadUrl(doc.r2_key, {
    expiresIn: 10 * 60,
    download,
    filename: doc.original_filename,
    responseContentType: doc.mime_type,
  });
  const [openUrl, downloadUrl] = await Promise.all([sign(false), sign(true)]);
  return {
    id: String(doc._id),
    original_filename: doc.original_filename,
    mime_type: doc.mime_type,
    bytes: doc.bytes,
    kind: doc.kind,
    status: doc.status,
    summary: doc.summary || '',
    key_facts: doc.key_facts || [],
    document_type: doc.document_type || '',
    created_at: doc.createdAt,
    open_url: openUrl,
    download_url: downloadUrl,
  };
}

export async function loadConversationDocuments({ userId, conversationId, sessionId, includePreview = false }) {
  return LeadDocument.find({
    user_id: userId,
    ...(includePreview ? {} : { preview: { $ne: true } }),
    $or: [
      conversationId ? { conversation_id: conversationId } : null,
      sessionId ? { session_id: sessionId } : null,
    ].filter(Boolean),
  }).sort({ createdAt: 1 }).lean();
}

export async function attachDocumentsToTurn({ userId, conversationId, sessionId, attachmentIds = [] }) {
  const ids = (Array.isArray(attachmentIds) ? attachmentIds : [])
    .map(String)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .slice(0, 3);
  if (!ids.length) return [];
  const docs = await LeadDocument.find({
    _id: { $in: ids },
    user_id: userId,
    $or: [{ session_id: sessionId }, { conversation_id: conversationId }],
  }).lean();
  if (docs.length) {
    await LeadDocument.updateMany(
      { _id: { $in: docs.map((doc) => doc._id) } },
      { $set: { conversation_id: conversationId, ...(sessionId ? { session_id: sessionId } : {}) } },
    );
  }
  return docs.map((doc) => ({
    id: String(doc._id),
    original_filename: doc.original_filename,
    kind: doc.kind,
    mime_type: doc.mime_type,
    status: doc.status,
  }));
}

export function leadDocumentLinkFilter({ userId, conversationId, sessionId }) {
  return {
    user_id: userId,
    preview: { $ne: true },
    lead_match_id: null,
    $or: [
      conversationId ? { conversation_id: conversationId } : null,
      sessionId ? { session_id: sessionId } : null,
    ].filter(Boolean),
  };
}

export async function linkConversationDocumentsToLead({ userId, conversationId, sessionId, leadMatchId, preview = false }) {
  if (preview || !leadMatchId || !userId || (!conversationId && !sessionId)) return { linked: 0 };
  const result = await LeadDocument.updateMany(
    leadDocumentLinkFilter({ userId, conversationId, sessionId }),
    { $set: { lead_match_id: leadMatchId, conversation_id: conversationId || undefined } },
  );
  return { linked: result.modifiedCount || 0 };
}

export async function listLeadDocuments(userId, leadMatchId) {
  const lead = await LeadMatch.findOne({ _id: leadMatchId, user_id: userId })
    .select('conversation_id compatibility_factors.session_id')
    .lean();
  if (lead) {
    await linkConversationDocumentsToLead({
      userId,
      conversationId: lead.conversation_id,
      sessionId: lead.compatibility_factors?.session_id,
      leadMatchId,
    });
  }
  const docs = await LeadDocument.find({
    user_id: userId,
    lead_match_id: leadMatchId,
    preview: { $ne: true },
  }).sort({ createdAt: -1 }).lean();
  return Promise.all(docs.map((doc) => publicDocumentView(doc)));
}

export async function deleteLeadDocument(userId, leadMatchId, documentId) {
  const doc = await LeadDocument.findOne({ _id: documentId, user_id: userId, lead_match_id: leadMatchId });
  if (!doc) return false;
  await deleteObjectFromR2(doc.r2_key);
  await doc.deleteOne();
  return true;
}
