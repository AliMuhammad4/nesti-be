import User from '../models/User.js';
import { isR2Configured, uploadBufferToR2 } from '../services/media/r2Client.js';
import logger from '../utils/logger.js';

const KINDS = new Set(['profile', 'cover', 'logo']);

function clampNumber(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * POST multipart: field `file` (image), field `kind` = `profile` | `cover` | `logo`.
 * Optional field `scope` = `storefront`:
 *   - Uploads to a storefront-only R2 key and returns the URL.
 *   - Does NOT update User.profile_image / User.cover_image (page-only assets).
 * Without storefront scope, profile/cover images update the User record (account-wide).
 * Logo assets are always returned for the Brand Kit to persist with its draft.
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
        message: 'Invalid kind. Use profile, cover, or logo.',
      });
    }

    const scope = String(req.body?.scope || '').trim().toLowerCase();
    const storefrontOnly = scope === 'storefront';
    const userId = String(req.user._id);
    const uploadVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const objectKey = storefrontOnly
      // Storefront assets must use immutable URLs. Reusing one key causes the
      // R2 CDN and Next/Image optimizer to keep serving the previous upload.
      ? `nesti/users/${userId}/storefront/${kind}-${uploadVersion}`
      : `nesti/users/${userId}/${kind}`;
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

    if (!storefrontOnly) {
      if (kind === 'cover') {
        user.cover_image = secureUrl;
        user.cover_image_position = { x: 50, y: 50 };
        user.cover_image_zoom = 1;
      } else if (kind === 'profile') {
        user.profile_image = secureUrl;
      }
      await user.save();
    }

    return res.json({
      success: true,
      message: storefrontOnly ? 'Storefront image uploaded' : 'Image uploaded',
      url: secureUrl,
      kind,
      scope: storefrontOnly ? 'storefront' : 'account',
      profile_image: user.profile_image || null,
      cover_image: user.cover_image || null,
      cover_image_position: user.cover_image_position || { x: 50, y: 50 },
      cover_image_zoom: user.cover_image_zoom || 1,
    });
  } catch (err) {
    logger.error('profile image upload', { error: err.message });
    return next(err);
  }
}

export async function postCoverImageAdjustments(req, res, next) {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const pos = req.body?.position || {};
    user.cover_image_position = {
      x: clampNumber(pos.x, { min: 0, max: 100, fallback: user.cover_image_position?.x ?? 50 }),
      y: clampNumber(pos.y, { min: 0, max: 100, fallback: user.cover_image_position?.y ?? 50 }),
    };
    user.cover_image_zoom = clampNumber(req.body?.zoom, {
      min: 1,
      max: 3,
      fallback: user.cover_image_zoom || 1,
    });

    await user.save();

    return res.json({
      success: true,
      message: 'Cover photo updated',
      cover_image: user.cover_image || null,
      cover_image_position: user.cover_image_position,
      cover_image_zoom: user.cover_image_zoom,
    });
  } catch (err) {
    logger.error('cover image adjustments', { error: err.message });
    return next(err);
  }
}
