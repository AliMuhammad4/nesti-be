import express from 'express';
import {
  getOwnPublicProfile,
  updatePublicProfile,
  getProfileAnalytics,
  exportProfileAnalytics,
  updateTheme,
  generatePublicProfileCopy,
} from '../controllers/professionalDashboardController.js';
import { protect } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import {
  updatePublicProfileSchema,
  updateThemeSchema,
} from '../schemas/publicProfileSchemas.js';

const router = express.Router();

router.use(protect);

router.get('/profile', getOwnPublicProfile);

router.post('/profile/generate-copy', generatePublicProfileCopy);

router.patch('/profile', validateBody(updatePublicProfileSchema), updatePublicProfile);

router.get('/analytics', getProfileAnalytics);

router.get('/analytics/export', exportProfileAnalytics);

router.patch('/profile/theme', validateBody(updateThemeSchema), updateTheme);

export default router;
