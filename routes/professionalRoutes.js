import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import {
  getMyProfessionalProfile,
  upsertProfessionalProfile,
} from '../controllers/professionalController.js';

router.get('/me', protect, getMyProfessionalProfile);
router.post('/', protect, upsertProfessionalProfile);
router.put('/', protect, upsertProfessionalProfile);
router.patch('/', protect, upsertProfessionalProfile);

export default router;
