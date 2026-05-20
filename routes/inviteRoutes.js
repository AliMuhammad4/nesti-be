import express from 'express';
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import {
  createInviteSchema,
  captureInviteSchema,
  finalizeInviteSchema,
} from '../schemas/inviteSchemas.js';
import {
  createInviteLink,
  listInviteLinks,
  resolveInvite,
  captureInvite,
  finalizeInvite,
  inviteMetrics,
  listInviteRewardEvents,
  listInviteConversions,
  inviteConversionRoleTrends,
  getRewardsProfile,
} from '../controllers/inviteController.js';

const router = express.Router();

router.post('/', protect, requireCompleteProfessionalProfile, validateBody(createInviteSchema), createInviteLink);
router.get('/', protect, requireCompleteProfessionalProfile, listInviteLinks);
router.get('/metrics', protect, requireCompleteProfessionalProfile, inviteMetrics);
router.get('/conversions/role-trends', protect, requireCompleteProfessionalProfile, inviteConversionRoleTrends);
router.get('/conversions', protect, requireCompleteProfessionalProfile, listInviteConversions);
router.get('/rewards/profile', protect, requireCompleteProfessionalProfile, getRewardsProfile);
router.get('/rewards/events', protect, requireCompleteProfessionalProfile, listInviteRewardEvents);
router.get('/resolve/:token', resolveInvite);
router.post('/capture', validateBody(captureInviteSchema), captureInvite);
router.post('/finalize', protect, validateBody(finalizeInviteSchema), finalizeInvite);

export default router;
