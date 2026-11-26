import express from 'express';
import {
  protect,
  ensureAgentOrMortgageBroker,
  requireCompleteProfessionalProfile,
} from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import {
  supportRequestNoteSchema,
  supportRequestPatchSchema,
  supportRequestReplySchema,
} from '../schemas/supportRequestSchemas.js';
import {
  addSupportRequestNote,
  deleteSupportRequest,
  deleteSupportRequestNote,
  getSupportRequest,
  getSupportRequestSummary,
  listSupportRequests,
  replySupportRequest,
  updateSupportRequest,
} from '../controllers/supportRequestController.js';

const router = express.Router();
// Support requests from the professional's web page contact form; each professional sees only their own.
const guard = [protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker];

router.get('/', ...guard, listSupportRequests);
router.get('/summary', ...guard, getSupportRequestSummary);
router.get('/:id', ...guard, getSupportRequest);
router.patch('/:id', ...guard, validateBody(supportRequestPatchSchema), updateSupportRequest);
router.post('/:id/notes', ...guard, validateBody(supportRequestNoteSchema), addSupportRequestNote);
router.delete('/:id/notes/:noteId', ...guard, deleteSupportRequestNote);
router.post('/:id/reply', ...guard, validateBody(supportRequestReplySchema), replySupportRequest);
router.delete('/:id', ...guard, deleteSupportRequest);

export default router;
