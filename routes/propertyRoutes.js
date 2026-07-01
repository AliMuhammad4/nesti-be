import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import {
  createPropertyConversation,
  createPropertyInquiry,
  getAvailableProperties,
  getPropertyById,
} from '../services/property/propertyService.js';

// Public routes - no authentication required for browsing properties
router.get('/', getAvailableProperties);
router.get('/:id', getPropertyById);
router.post('/:id/inquiries', protect, createPropertyInquiry);
router.post('/:id/thread', protect, createPropertyConversation);

export default router;
