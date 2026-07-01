import express from 'express';
const router = express.Router();

import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { uploadProChatAttachment } from '../middleware/uploadProChatAttachment.js';
import { USER_ROLE } from '../constants/roles.js';
import { FEATURES } from '../services/billing/entitlements.js';
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

function ensureClient(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
  if (String(req.user.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
    return res.status(403).json({ success: false, message: 'Client chat routes are only available to clients.' });
  }
  return next();
}

router.get('/client/threads', protect, ensureClient, listMyThreads);
router.post('/client/threads', protect, ensureClient, createOrGetThread);
router.get('/client/threads/:id', protect, ensureClient, getThreadById);
router.get('/client/threads/:id/messages', protect, ensureClient, listThreadMessages);
router.post('/client/threads/:id/messages', protect, ensureClient, postThreadMessage);
router.post('/client/threads/:id/attachments', protect, ensureClient, runProChatUpload, postProChatAttachmentUpload);

router.get('/threads', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT_DM), listMyThreads);
router.post('/threads', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT_DM), createOrGetThread);
router.post('/groups', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), createGroupThread);
router.patch('/groups/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), updateGroupThread);
router.delete('/groups/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), deleteGroupThread);
router.post('/groups/:id/members', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), addGroupMembers);
router.delete('/groups/:id/members/:userId', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), removeGroupMember);
router.post('/groups/:id/leave', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), leaveGroupThread);
router.post('/groups/:id/rejoin-request', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), requestRejoinGroupThread);
router.get('/groups/:id/rejoin-requests', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), listGroupRejoinRequests);
router.post('/groups/:id/rejoin-requests/:userId/:action', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT), resolveGroupRejoinRequest);
router.get('/threads/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT_DM), getThreadById);
router.get('/threads/:id/messages', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT_DM), listThreadMessages);
router.post('/threads/:id/messages', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT_DM), postThreadMessage);
router.post('/threads/:id/attachments', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.PRO_CHAT_DM), runProChatUpload, postProChatAttachmentUpload);

export default router;

