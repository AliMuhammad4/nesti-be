import express from 'express';
const router = express.Router();

import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import {
  createOrGetThread,
  getThreadById,
  listMyThreads,
  listThreadMessages,
  postThreadMessage,
} from '../controllers/proChatController.js';

router.get('/threads', protect, requireCompleteProfessionalProfile, listMyThreads);
router.post('/threads', protect, requireCompleteProfessionalProfile, createOrGetThread);
router.get('/threads/:id', protect, requireCompleteProfessionalProfile, getThreadById);
router.get('/threads/:id/messages', protect, requireCompleteProfessionalProfile, listThreadMessages);
router.post('/threads/:id/messages', protect, requireCompleteProfessionalProfile, postThreadMessage);

export default router;

