import express from 'express';
import {
  getPublicProfileBySlug,
  getPublicProfessionalNetwork,
  getPublicProfessionalsList,
  getSellerProperties,
  trackProfileView,
  checkSlugAvailability,
} from '../controllers/publicProfileController.js';
import { optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/professionals', getPublicProfessionalsList);
router.get('/professional-network', getPublicProfessionalNetwork);
router.get('/professionals/:slug/properties', getSellerProperties);
router.get('/professionals/:slug', getPublicProfileBySlug);

router.post('/professionals/:slug/analytics', optionalAuth, trackProfileView);

router.post('/slug/check', optionalAuth, checkSlugAvailability);

export default router;
