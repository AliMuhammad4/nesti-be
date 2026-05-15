import User from '../models/User.js';
import { cloudinary, isCloudinaryConfigured } from '../services/media/cloudinaryClient.js';
import logger from '../utils/logger.js';

const KINDS = new Set(['profile', 'cover']);

/**
 * POST multipart: field `file` (image), field `kind` = `profile` | `cover`
 * Uploads to Cloudinary and saves HTTPS URL on User.
 */
export async function postProfileImageUpload(req, res, next) {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Image upload is not configured (missing Cloudinary environment variables).',
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
    const folder = `nesti/users/${userId}`;
    const publicId = kind === 'cover' ? 'cover' : 'profile';
    const b64 = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${b64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
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
