import express from 'express';
const router = express.Router();
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { requireActiveSubscriptionAccess } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { professionalUpsertBodySchema } from '../schemas/userProfileSchemas.js';
import { ICP_SCHEMA_BY_ROLE } from '../schemas/icpSchemas.js';
import {
  getMyProfessionalProfile,
  upsertProfessionalProfile,
  getIdealClientProfile,
  saveIdealClientProfile,
  listProfessionalsByRole,
  getProfessionalById,
} from '../controllers/professionalController.js';
import { postProfileImageUpload } from '../controllers/profileMediaController.js';
import { uploadProfileImage } from '../middleware/uploadProfileImage.js';

function runProfileUpload(req, res, next) {
  uploadProfileImage.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Invalid file upload' });
    }
    next();
  });
}

function validateIcpByRole(req, res, next) {
  const role = req.user?.role;
  const schema = ICP_SCHEMA_BY_ROLE[role];
  if (!schema) {
    return res.status(400).json({ success: false, message: `No ICP schema for role: ${role}` });
  }
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      details: error.details.map((d) => d.message),
    });
  }
  req.body = value;
  next();
}

router.get('/me', protect, requireActiveSubscriptionAccess, getMyProfessionalProfile);
router.get('/list', protect, requireActiveSubscriptionAccess, listProfessionalsByRole);
router.post('/upload-image', protect, requireActiveSubscriptionAccess, runProfileUpload, postProfileImageUpload);
router.get('/icp', protect, requireActiveSubscriptionAccess, requireCompleteProfessionalProfile, getIdealClientProfile);
router.post('/icp', protect, requireActiveSubscriptionAccess, requireCompleteProfessionalProfile, validateIcpByRole, saveIdealClientProfile);
router.put('/icp', protect, requireActiveSubscriptionAccess, requireCompleteProfessionalProfile, validateIcpByRole, saveIdealClientProfile);

router.get('/:id', protect, requireActiveSubscriptionAccess, getProfessionalById);
router.post('/', protect, requireActiveSubscriptionAccess, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);
router.put('/', protect, requireActiveSubscriptionAccess, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);
router.patch('/', protect, requireActiveSubscriptionAccess, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);

export default router;
