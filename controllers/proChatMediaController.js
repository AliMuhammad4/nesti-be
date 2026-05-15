import crypto from 'crypto';
import ProfessionalChatThread from '../models/ProfessionalChatThread.js';
import { cloudinary, isCloudinaryConfigured } from '../services/media/cloudinaryClient.js';

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

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

/**
 * POST multipart: field `file`
 * Uploads to Cloudinary and returns attachment metadata for pro-chat messages.
 */
export async function postProChatAttachmentUpload(req, res, next) {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'File upload is not configured (missing Cloudinary environment variables).',
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
    const folder = `nesti/prochat/threads/${tid}`;
    const publicId = `att_${Date.now()}_${safeRandomId(6)}`;

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder,
      public_id: publicId,
      overwrite: false,
      // Images can be delivered via CDN normally; docs/PDFs often require restricted delivery in some environments.
      type: isImage ? 'upload' : 'private',
      resource_type: isImage ? 'image' : 'raw',
      format: isPdf ? 'pdf' : undefined,
    });

    const secureUrl = result?.secure_url || result?.url || null;
    if (!secureUrl) {
      return res.status(502).json({ success: false, message: 'Upload failed: no URL returned.' });
    }

    // For PDFs/docs, return signed time-limited URLs that work even when direct CDN delivery is restricted.
    const format = String(result?.format || (isPdf ? 'pdf' : '') || '').trim() || null;
    const public_id = result?.public_id || null;
    const resource_type = result?.resource_type || (isImage ? 'image' : 'raw');
    const now = Math.floor(Date.now() / 1000);
    const expires_at = now + 60 * 60 * 24 * 30; // 30 days
    const openUrl =
      !isImage && public_id && format
        ? cloudinary.utils.private_download_url(public_id, format, {
            resource_type: 'raw',
            type: 'private',
            expires_at,
            attachment: false,
          })
        : null;
    const downloadUrl =
      !isImage && public_id && format
        ? cloudinary.utils.private_download_url(public_id, format, {
            resource_type: 'raw',
            type: 'private',
            expires_at,
            attachment: true,
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
        bytes: result?.bytes != null ? Number(result.bytes) : null,
        original_filename: result?.original_filename || null,
        filename: req.file.originalname || null,
        mime_type: mime || null,
      },
    });
  } catch (err) {
    return next(err);
  }
}

