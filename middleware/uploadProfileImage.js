import multer from 'multer';

const MAX_BYTES = 4 * 1024 * 1024;

export const uploadProfileImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed.'));
      return;
    }
    cb(null, true);
  },
});
