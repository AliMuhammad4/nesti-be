import express from 'express';
const router = express.Router();
import { protect, requireCompleteProfessionalProfile, ensureCredentialApproved } from '../middleware/authMiddleware.js';
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
import { postCoverImageAdjustments, postProfileImageUpload } from '../controllers/profileMediaController.js';
import {
  deleteCredentialDocument,
  getCredentialDocument,
  getMyCredentials,
  patchCredentialMeta,
  submitCredentials,
  uploadCredentialDocument,
} from '../controllers/credentialController.js';
import { uploadProfileImage } from '../middleware/uploadProfileImage.js';
import { uploadCredentialDocument as uploadCredentialMulter } from '../middleware/uploadCredentialDocument.js';
import { MAX_IMAGE_UPLOAD_MB } from '../constants/mediaLimits.js';

function runProfileUpload(req, res, next) {
  uploadProfileImage.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: `Image must be under ${MAX_IMAGE_UPLOAD_MB}MB.`,
        });
      }
      return res.status(400).json({ success: false, message: err.message || 'Invalid file upload' });
    }
    next();
  });
}

function runCredentialUpload(req, res, next) {
  uploadCredentialMulter.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: `File must be under ${MAX_IMAGE_UPLOAD_MB}MB.`,
        });
      }
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

// Credential verification — available without active subscription / before approval
router.get('/me/credentials', protect, getMyCredentials);
router.patch('/me/credentials', protect, patchCredentialMeta);
router.post('/me/credentials/documents', protect, runCredentialUpload, uploadCredentialDocument);
router.get('/me/credentials/documents/:docId', protect, getCredentialDocument);
router.delete('/me/credentials/documents/:docId', protect, deleteCredentialDocument);
router.post('/me/credentials/submit', protect, submitCredentials);

router.get('/me', protect, requireActiveSubscriptionAccess, ensureCredentialApproved, getMyProfessionalProfile);
router.get('/list', protect, requireActiveSubscriptionAccess, ensureCredentialApproved, listProfessionalsByRole);
router.post('/upload-image', protect, runProfileUpload, postProfileImageUpload);
router.post('/cover-adjustments', protect, postCoverImageAdjustments);
router.get('/icp', protect, requireActiveSubscriptionAccess, ensureCredentialApproved, requireCompleteProfessionalProfile, getIdealClientProfile);
router.post('/icp', protect, requireActiveSubscriptionAccess, ensureCredentialApproved, requireCompleteProfessionalProfile, validateIcpByRole, saveIdealClientProfile);
router.put('/icp', protect, requireActiveSubscriptionAccess, ensureCredentialApproved, requireCompleteProfessionalProfile, validateIcpByRole, saveIdealClientProfile);

router.get('/:id', protect, requireActiveSubscriptionAccess, ensureCredentialApproved, getProfessionalById);
router.post('/', protect, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);
router.put('/', protect, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);
router.patch('/', protect, validateBody(professionalUpsertBodySchema), upsertProfessionalProfile);

export default router;
