import express from 'express';
import {
  getOwnPublicProfile,
  updatePublicProfile,
  getProfileAnalytics,
  exportProfileAnalytics,
  updateTheme,
  generatePublicProfileCopy,
  deletePublicProfile,
} from '../controllers/professionalDashboardController.js';
import { protect } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { FEATURES } from '../services/billing/entitlements.js';
import {
  updatePublicProfileSchema,
  updateThemeSchema,
} from '../schemas/publicProfileSchemas.js';

const router = express.Router();

router.use(protect);

router.get('/profile', requireFeature(FEATURES.PUBLIC_PROFILE), getOwnPublicProfile);

router.post('/profile/generate-copy', requireFeature(FEATURES.ASSISTANT_PROFESSIONAL), generatePublicProfileCopy);

router.patch('/profile', requireFeature(FEATURES.PUBLIC_PROFILE), validateBody(updatePublicProfileSchema), updatePublicProfile);

router.delete('/profile', requireFeature(FEATURES.PUBLIC_PROFILE), deletePublicProfile);

router.get('/analytics', requireFeature(FEATURES.PROFILE_ANALYTICS), getProfileAnalytics);

router.get('/analytics/export', requireFeature(FEATURES.PROFILE_ANALYTICS), exportProfileAnalytics);

router.patch('/profile/theme', requireFeature(FEATURES.PUBLIC_PROFILE), validateBody(updateThemeSchema), updateTheme);

export default router;
