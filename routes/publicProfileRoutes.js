import express from 'express';
import {
  getPublicProfileBySlug,
  getPublicProfessionalNetwork,
  getPublicProfessionalsList,
  getSellerProperties,
  trackProfileView,
  checkSlugAvailability,
  submitPublicLead,
} from '../controllers/publicProfileController.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { submitPublicLeadSchema } from '../schemas/publicProfileSchemas.js';

const router = express.Router();

router.get('/professionals', getPublicProfessionalsList);
router.get('/professional-network', getPublicProfessionalNetwork);
router.get('/professionals/:slug/properties', getSellerProperties);
router.get('/professionals/:slug', getPublicProfileBySlug);
router.post('/professionals/:slug/lead', optionalAuth, validateBody(submitPublicLeadSchema), submitPublicLead);

router.post('/professionals/:slug/analytics', optionalAuth, trackProfileView);

router.post('/slug/check', optionalAuth, checkSlugAvailability);

export default router;
