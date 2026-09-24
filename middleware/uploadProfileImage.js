import multer from 'multer';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_MB } from '../constants/mediaLimits.js';

export const uploadProfileImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed.'));
      return;
    }
    cb(null, true);
  },
});

/** Express middleware: multer single `file` with friendly size/type errors. */
export function runProfileUpload(req, res, next) {
  uploadProfileImage.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: `Image must be under ${MAX_IMAGE_UPLOAD_MB}MB.`,
        });
      }
      return res.status(400).json({ success: false, message: err.message || 'Invalid file upload' });
    }
    next();
  });
}
