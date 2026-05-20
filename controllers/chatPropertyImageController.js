import crypto from 'crypto';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import { cloudinary, isCloudinaryConfigured } from '../services/media/cloudinaryClient.js';

function safeId(bytes = 6) {
  try {
    return crypto.randomBytes(bytes).toString('hex');
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
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

export async function postPropertyImagesUpload(req, res, next) {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Image upload is not configured (missing Cloudinary environment variables).',
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
        const result = await uploadBufferToCloudinary(file.buffer, {
          folder,
          public_id: `property_${Date.now()}_${idx}_${safeId(4)}`,
          overwrite: false,
          resource_type: 'image',
        });
        const url = result?.secure_url || result?.url || '';
        return {
          url,
          secure_url: url,
          public_id: result?.public_id || '',
          width: result?.width != null ? Number(result.width) : null,
          height: result?.height != null ? Number(result.height) : null,
          format: result?.format || '',
          bytes: result?.bytes != null ? Number(result.bytes) : null,
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
