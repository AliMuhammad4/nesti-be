import express from 'express';
const router = express.Router();
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { FEATURES } from '../services/billing/entitlements.js';
import { referralPostBodySchema, referralPatchBodySchema } from '../schemas/chatRouteSchemas.js';
import {
  createReferral,
  listReferrals,
  listReferralsForLeadMatch,
  patchReferral,
  getReferralLeadDetails,
  processReferral,
} from '../controllers/referralController.js';

router.post(
  '/',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.REFERRALS_MANUAL),
  validateBody(referralPostBodySchema),
  createReferral
);
router.get('/', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_MANUAL), listReferrals);
router.get('/lead-match/:leadMatchId', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_MANUAL), listReferralsForLeadMatch);
router.get('/:id/lead', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_MANUAL), getReferralLeadDetails);
router.patch(
  '/:id',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.REFERRALS_MANUAL),
  validateBody(referralPatchBodySchema),
  patchReferral
);
router.post('/:id/process', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.REFERRALS_MANUAL), processReferral);

export default router;
