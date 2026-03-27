import express from 'express';
import { protect, ensureAgent } from '../../middleware/authMiddleware.js';
import {
  getMyPropertyMatchScoring,
  putMyPropertyMatchScoring,
} from '../../controllers/agent/propertyMatchScoringController.js';

const router = express.Router();

router.get('/', protect, ensureAgent, getMyPropertyMatchScoring);
router.put('/', protect, ensureAgent, putMyPropertyMatchScoring);

export default router;
