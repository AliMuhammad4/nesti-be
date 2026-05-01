import express from 'express';
const router = express.Router();
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { referralPostBodySchema, referralPatchBodySchema } from '../schemas/chatRouteSchemas.js';
import {
  createReferral,
  listReferrals,
  patchReferral,
  getReferralLeadDetails,
  processReferral,
} from '../controllers/referralController.js';

router.post(
  '/',
  protect,
  requireCompleteProfessionalProfile,
  validateBody(referralPostBodySchema),
  createReferral
);
router.get('/', protect, requireCompleteProfessionalProfile, listReferrals);
router.get('/:id/lead', protect, requireCompleteProfessionalProfile, getReferralLeadDetails);
router.patch(
  '/:id',
  protect,
  requireCompleteProfessionalProfile,
  validateBody(referralPatchBodySchema),
  patchReferral
);
router.post('/:id/process', protect, requireCompleteProfessionalProfile, processReferral);

export default router;
