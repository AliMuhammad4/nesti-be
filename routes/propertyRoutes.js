import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import {
  createPropertyConversation,
  createPropertyInquiry,
  getAvailableProperties,
  getPropertyById,
} from '../services/property/propertyService.js';
import { requireClientFeature } from '../middleware/clientSubscriptionAccess.js';
import { CLIENT_FEATURE } from '../services/client/plans.js';

// Public routes - no authentication required for browsing properties
router.get('/', getAvailableProperties);
router.get('/:id', getPropertyById);
router.post('/:id/inquiries', protect, requireClientFeature(CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS), createPropertyInquiry);
router.post('/:id/thread', protect, requireClientFeature(CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS), createPropertyConversation);

export default router;
