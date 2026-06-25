import multer from 'multer';
import { MAX_IMAGE_UPLOAD_BYTES } from '../constants/mediaLimits.js';

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
