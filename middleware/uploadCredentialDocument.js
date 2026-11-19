import multer from 'multer';
import { MAX_IMAGE_UPLOAD_BYTES } from '../constants/mediaLimits.js';

const ALLOWED = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const uploadCredentialDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file?.mimetype || '').trim().toLowerCase();
    // Some browsers send no type (or a generic one) for valid files; the extension is accepted
    // here and the file's actual contents are checked before anything is stored.
    const genericType = !mime || mime === 'application/octet-stream';
    const knownExtension = /\.(jpe?g|png|webp|pdf)$/i.test(String(file?.originalname || ''));
    if (genericType ? !knownExtension : !ALLOWED.has(mime)) {
      cb(new Error('Unsupported file type. Upload a JPEG, PNG, WEBP, or PDF.'));
      return;
    }
    cb(null, true);
  },
});

// Files are held in memory (up to the size limit each) until stored, so cap how many
// uploads run at once, in total and per account (a few at once is fine: the settings page
// uploads each document card separately).
const MAX_CONCURRENT_UPLOADS = Math.max(1, Number.parseInt(process.env.CREDENTIAL_UPLOAD_CONCURRENCY || '6', 10) || 6);
const MAX_UPLOADS_PER_USER = 3;
let uploadsInFlight = 0;
const userUploads = new Map();

export function limitCredentialUploads(req, res, next) {
  const userKey = req.user?._id ? String(req.user._id) : '';
  const mine = userKey ? userUploads.get(userKey) || 0 : 0;
  if (uploadsInFlight >= MAX_CONCURRENT_UPLOADS || mine >= MAX_UPLOADS_PER_USER) {
    res.set('Retry-After', '3');
    return res.status(429).json({
      success: false,
      message: mine >= MAX_UPLOADS_PER_USER
        ? 'Other uploads are still in progress. Try again when they finish.'
        : 'Uploads are busy right now. Try again in a moment.',
    });
  }
  uploadsInFlight += 1;
  if (userKey) userUploads.set(userKey, mine + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    uploadsInFlight -= 1;
    if (!userKey) return;
    const left = (userUploads.get(userKey) || 1) - 1;
    if (left > 0) userUploads.set(userKey, left);
    else userUploads.delete(userKey);
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
}
