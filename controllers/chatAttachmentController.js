import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import ChatConversation from '../models/ChatConversation.js';
import { publicDocumentView, saveChatDocument } from '../services/chat/documents/chatDocumentService.js';

const recentUploads = new Map();

function allowUpload(sessionId) {
  const key = String(sessionId || 'anon');
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const hits = (recentUploads.get(key) || []).filter((time) => now - time < windowMs);
  if (hits.length >= 20) return false;
  hits.push(now);
  recentUploads.set(key, hits);
  return true;
}

export async function postChatAttachment(req, res, next) {
  try {
    const embedToken = String(req.body?.embedToken || '').trim();
    const sessionId = String(req.body?.sessionId || req.body?.id || '').trim();
    const preview = req.body?.preview === true || req.body?.preview === 'true';
    if (!embedToken || !sessionId) {
      return res.status(400).json({ success: false, message: 'embedToken and sessionId are required' });
    }
    if (!allowUpload(sessionId)) {
      return res.status(429).json({ success: false, message: 'Too many files. Try again later.' });
    }
    const embed = await ChatbotEmbedUrl.findOne({ token: embedToken }).select('user_id').lean();
    if (!embed?.user_id) {
      return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
    }
    if (preview && String(req.user?._id || '') !== String(embed.user_id)) {
      return res.status(403).json({ success: false, message: 'Sign in again to preview unsaved changes.' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'Missing file.' });
    }
    const conversation = await ChatConversation.findOne({ session_id: sessionId, user_id: embed.user_id }).select('_id').lean();
    const doc = await saveChatDocument({
      userId: embed.user_id,
      sessionId,
      conversationId: conversation?._id || null,
      buffer: req.file.buffer,
      filename: req.file.originalname,
      declaredMime: req.file.mimetype,
      preview,
    });
    const view = await publicDocumentView(doc);
    return res.status(201).json({ success: true, document: view });
  } catch (error) {
    if (error?.message === 'R2 is not configured') {
      return res.status(503).json({ success: false, message: 'File storage is not configured.' });
    }
    if (error?.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return next(error);
  }
}
