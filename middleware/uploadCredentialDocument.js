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
    if (!mime || !ALLOWED.has(mime)) {
      cb(new Error('Unsupported file type. Upload a JPEG, PNG, WEBP, or PDF.'));
      return;
    }
    cb(null, true);
  },
});
