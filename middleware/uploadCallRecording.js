import multer from 'multer';

const MAX_BYTES = 40 * 1024 * 1024;

export const uploadCallRecording = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!mime.startsWith('audio/')) {
      cb(new Error('Upload an audio recording.'));
      return;
    }
    cb(null, true);
  },
});

export function runCallRecordingUpload(req, res, next) {
  uploadCallRecording.single('file')(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.code === 'LIMIT_FILE_SIZE';
    res.status(400).json({ success: false, message: tooLarge ? 'Recording is too large.' : error.message || 'Recording upload failed.' });
  });
}
