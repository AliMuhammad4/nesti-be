import express from 'express';
const router = express.Router();
import {
  getFeaturedProfessionals,
  getFeaturedProfessionalsByRoleEndpoint,
} from '../controllers/featuredController.js';

router.get('/professionals', getFeaturedProfessionals);
router.get('/professionals/:role', getFeaturedProfessionalsByRoleEndpoint);

export default router;
