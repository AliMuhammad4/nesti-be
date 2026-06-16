import crypto from 'crypto';
import ProfessionalChatThread from '../models/ProfessionalChatThread.js';
import { createSignedReadUrl, isR2Configured, uploadBufferToR2 } from '../services/media/r2Client.js';

function safeRandomId(bytes = 8) {
  try {
    return crypto.randomBytes(bytes).toString('hex');
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

async function assertThreadMembership(threadId, userId) {
  const tid = String(threadId || '').trim();
  if (!tid) return { status: 400, body: { success: false, message: 'Missing thread id' } };
  const thread = await ProfessionalChatThread.findById(tid).select('participants').lean();
  if (!thread) return { status: 404, body: { success: false, message: 'Thread not found' } };
  const me = String(userId || '').trim();
  const parts = (thread.participants || []).map((p) => String(p));
  if (!me || !parts.includes(me)) {
    return { status: 403, body: { success: false, message: 'Not a participant in this thread' } };
  }
  return { status: 200, tid, thread };
}

function extFromNameOrMime(filename, mime) {
  const name = String(filename || '').trim();
  const fromName = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (fromName) return fromName.slice(0, 12);
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  };
  return map[String(mime || '').toLowerCase()] || '';
}

/**
 * POST multipart: field `file`
 * Uploads to R2 and returns attachment metadata for pro-chat messages.
 */
export async function postProChatAttachmentUpload(req, res, next) {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({
        success: false,
        message: 'File upload is not configured (missing Cloudflare R2 environment variables).',
      });
    }
    const me = req.user?._id;
    const check = await assertThreadMembership(req.params?.id, me);
    if (check.status !== 200) return res.status(check.status).json(check.body);
    const tid = String(check.tid);

    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'Missing file (field name: file).' });
    }

    const mime = String(req.file.mimetype || '').trim().toLowerCase();
    const isImage = mime.startsWith('image/');
    const isPdf = mime === 'application/pdf';
    const ext = extFromNameOrMime(req.file.originalname, mime);
    const objectKey = `nesti/prochat/threads/${tid}/att_${Date.now()}_${safeRandomId(6)}${ext}`;

    const result = await uploadBufferToR2(req.file.buffer, {
      key: objectKey,
      mimeType: mime || undefined,
      contentDisposition: isImage ? undefined : 'inline',
    });

    const secureUrl = result?.secure_url || result?.url || null;
    if (!secureUrl) {
      return res.status(502).json({ success: false, message: 'Upload failed: no URL returned.' });
    }

    const format = ext ? ext.replace(/^\./, '').toLowerCase() : isPdf ? 'pdf' : null;
    const public_id = result?.public_id || objectKey;
    const resource_type = isImage ? 'image' : 'raw';
    const openUrl =
      !isImage && public_id
        ? await createSignedReadUrl(public_id, {
            expiresIn: 60 * 60 * 24 * 7,
            download: false,
            filename: req.file.originalname || undefined,
            responseContentType: mime || undefined,
          })
        : null;
    const downloadUrl =
      !isImage && public_id
        ? await createSignedReadUrl(public_id, {
            expiresIn: 60 * 60 * 24 * 7,
            download: true,
            filename: req.file.originalname || undefined,
            responseContentType: mime || undefined,
          })
        : null;

    return res.json({
      success: true,
      attachment: {
        url: openUrl || secureUrl,
        secure_url: openUrl || secureUrl,
        open_url: openUrl || secureUrl,
        download_url: downloadUrl || null,
        public_id,
        resource_type,
        format,
        bytes: result?.bytes != null ? Number(result.bytes) : Number(req.file.size || 0) || null,
        original_filename: req.file.originalname || null,
        filename: req.file.originalname || null,
        mime_type: mime || null,
      },
    });
  } catch (err) {
    return next(err);
  }
}

