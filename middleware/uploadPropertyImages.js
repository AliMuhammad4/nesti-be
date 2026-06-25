import multer from 'multer';
import { MAX_IMAGE_UPLOAD_BYTES } from '../constants/mediaLimits.js';

const MAX_FILES = 8;

export const uploadPropertyImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, WEBP, or GIF property images are allowed.'));
      return;
    }
    cb(null, true);
  },
});
