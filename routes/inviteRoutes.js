import express from 'express';
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { FEATURES } from '../services/billing/entitlements.js';
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

router.post('/', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_INVITES), validateBody(createInviteSchema), createInviteLink);
router.get('/', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_INVITES), listInviteLinks);
router.get('/metrics', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_INVITES), inviteMetrics);
router.get('/conversions/role-trends', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.DASHBOARD_ANALYTICS), inviteConversionRoleTrends);
router.get('/conversions', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_INVITES), listInviteConversions);
router.get('/rewards/profile', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_INVITES), getRewardsProfile);
router.get('/rewards/events', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_INVITES), listInviteRewardEvents);
router.get('/resolve/:token', resolveInvite);
router.post('/capture', validateBody(captureInviteSchema), captureInvite);
router.post('/finalize', protect, validateBody(finalizeInviteSchema), finalizeInvite);

export default router;
