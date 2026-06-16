import User from '../models/User.js';
import { isR2Configured, uploadBufferToR2 } from '../services/media/r2Client.js';
import logger from '../utils/logger.js';

const KINDS = new Set(['profile', 'cover']);

/**
 * POST multipart: field `file` (image), field `kind` = `profile` | `cover`
 * Uploads to R2 and saves HTTPS URL on User.
 */
export async function postProfileImageUpload(req, res, next) {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({
        success: false,
        message: 'Image upload is not configured (missing Cloudflare R2 environment variables).',
      });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'Missing image file (field name: file).' });
    }
    const kind = String(req.body?.kind || '').trim().toLowerCase();
    if (!KINDS.has(kind)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid kind. Use profile or cover.',
      });
    }

    const userId = String(req.user._id);
    const objectKey = `nesti/users/${userId}/${kind === 'cover' ? 'cover' : 'profile'}`;
    const result = await uploadBufferToR2(req.file.buffer, {
      key: objectKey,
      mimeType: req.file.mimetype,
      cacheControl: 'public, max-age=3600',
    });

    const secureUrl = result.secure_url;
    if (!secureUrl) {
      return res.status(502).json({ success: false, message: 'Upload failed: no URL returned.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (kind === 'cover') {
      user.cover_image = secureUrl;
    } else {
      user.profile_image = secureUrl;
    }
    await user.save();

    return res.json({
      success: true,
      message: 'Image uploaded',
      url: secureUrl,
      kind,
      profile_image: user.profile_image || null,
      cover_image: user.cover_image || null,
    });
  } catch (err) {
    logger.error('profile image upload', { error: err.message });
    return next(err);
  }
}
