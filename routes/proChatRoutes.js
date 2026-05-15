import express from 'express';
const router = express.Router();

import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { uploadProChatAttachment } from '../middleware/uploadProChatAttachment.js';
import {
  createOrGetThread,
  createGroupThread,
  updateGroupThread,
  addGroupMembers,
  deleteGroupThread,
  removeGroupMember,
  leaveGroupThread,
  requestRejoinGroupThread,
  listGroupRejoinRequests,
  resolveGroupRejoinRequest,
  getThreadById,
  listMyThreads,
  listThreadMessages,
  postThreadMessage,
} from '../controllers/proChatController.js';
import { postProChatAttachmentUpload } from '../controllers/proChatMediaController.js';

function runProChatUpload(req, res, next) {
  uploadProChatAttachment.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Invalid file upload' });
    }
    next();
  });
}

router.get('/threads', protect, requireCompleteProfessionalProfile, listMyThreads);
router.post('/threads', protect, requireCompleteProfessionalProfile, createOrGetThread);
router.post('/groups', protect, requireCompleteProfessionalProfile, createGroupThread);
router.patch('/groups/:id', protect, requireCompleteProfessionalProfile, updateGroupThread);
router.delete('/groups/:id', protect, requireCompleteProfessionalProfile, deleteGroupThread);
router.post('/groups/:id/members', protect, requireCompleteProfessionalProfile, addGroupMembers);
router.delete('/groups/:id/members/:userId', protect, requireCompleteProfessionalProfile, removeGroupMember);
router.post('/groups/:id/leave', protect, requireCompleteProfessionalProfile, leaveGroupThread);
router.post('/groups/:id/rejoin-request', protect, requireCompleteProfessionalProfile, requestRejoinGroupThread);
router.get('/groups/:id/rejoin-requests', protect, requireCompleteProfessionalProfile, listGroupRejoinRequests);
router.post('/groups/:id/rejoin-requests/:userId/:action', protect, requireCompleteProfessionalProfile, resolveGroupRejoinRequest);
router.get('/threads/:id', protect, requireCompleteProfessionalProfile, getThreadById);
router.get('/threads/:id/messages', protect, requireCompleteProfessionalProfile, listThreadMessages);
router.post('/threads/:id/messages', protect, requireCompleteProfessionalProfile, postThreadMessage);
router.post('/threads/:id/attachments', protect, requireCompleteProfessionalProfile, runProChatUpload, postProChatAttachmentUpload);

export default router;

