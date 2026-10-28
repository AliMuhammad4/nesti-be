import multer from 'multer';

const ALLOWED = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const MAX_CHATBOT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const uploadChatbotAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHATBOT_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file?.mimetype || '').trim().toLowerCase();
    const name = String(file?.originalname || '').toLowerCase();
    const extensionOk = /\.(pdf|doc|docx|jpe?g|png|webp|heic|heif)$/.test(name);
    const genericMime = mime === '' || mime === 'application/octet-stream';
    if (!ALLOWED.has(mime) && !(genericMime && extensionOk)) {
      cb(new Error('Upload a PDF, Word document, or image.'));
      return;
    }
    cb(null, true);
  },
});
