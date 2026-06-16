import multer from 'multer';

// Keep modest to avoid memory pressure (multer memoryStorage keeps the full buffer).
// Keep this conservative even with R2 so uploads stay responsive in chat.
const MAX_BYTES = 12 * 1024 * 1024; // 12MB

const ALLOWED = new Set([
  // images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  // docs
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export const uploadProChatAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file?.mimetype || '').trim().toLowerCase();
    if (!mime || !ALLOWED.has(mime)) {
      cb(new Error('Unsupported file type. Upload an image, PDF, or office document.'));
      return;
    }
    cb(null, true);
  },
});

