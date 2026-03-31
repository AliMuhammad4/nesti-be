import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { professionalUpsertBodySchema } from '../schemas/userProfileSchemas.js';
import {
  getMyProfessionalProfile,
  upsertProfessionalProfile,
} from '../controllers/professionalController.js';

router.get('/me', protect, getMyProfessionalProfile);
router.post('/', protect, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);
router.put('/', protect, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);
router.patch('/', protect, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);

export default router;
