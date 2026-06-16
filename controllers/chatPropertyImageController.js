import crypto from 'crypto';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import { isR2Configured, uploadBufferToR2 } from '../services/media/r2Client.js';

function safeId(bytes = 6) {
  try {
    return crypto.randomBytes(bytes).toString('hex');
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export async function postPropertyImagesUpload(req, res, next) {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({
        success: false,
        message: 'Image upload is not configured (missing Cloudflare R2 environment variables).',
      });
    }

    const embedToken = String(req.body?.embedToken || '').trim();
    const sessionId = String(req.body?.sessionId || req.body?.id || '').trim();
    if (!embedToken || !sessionId) {
      return res.status(400).json({ success: false, message: 'embedToken and sessionId are required.' });
    }

    const embed = await ChatbotEmbedUrl.findOne({ token: embedToken }).select('_id user_id widget_role').lean();
    if (!embed) {
      return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ success: false, message: 'Upload at least one property image.' });
    }

    const folder = `nesti/property-leads/${String(embed.user_id)}/${sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96)}`;
    const uploaded = await Promise.all(
      files.slice(0, 8).map(async (file, idx) => {
        const objectKey = `${folder}/property_${Date.now()}_${idx}_${safeId(4)}`;
        const result = await uploadBufferToR2(file.buffer, {
          key: objectKey,
          mimeType: file.mimetype,
        });
        const url = result?.secure_url || result?.url || '';
        return {
          url,
          secure_url: url,
          public_id: result?.public_id || objectKey,
          width: null,
          height: null,
          format: String(file.mimetype || '').split('/')[1] || '',
          bytes: result?.bytes != null ? Number(result.bytes) : Number(file.size || 0) || null,
          original_filename: file.originalname || '',
          uploaded_at: new Date().toISOString(),
        };
      }),
    );

    return res.json({ success: true, images: uploaded.filter((img) => img.url) });
  } catch (err) {
    return next(err);
  }
}
