import express from 'express';
const router = express.Router();
import { getAvailableProperties, getPropertyById } from '../services/property/propertyService.js';

// Public routes - no authentication required for browsing properties
router.get('/', getAvailableProperties);
router.get('/:id', getPropertyById);

export default router;
