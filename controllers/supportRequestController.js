import {
  addSupportRequestNoteService,
  deleteSupportRequestNoteService,
  deleteSupportRequestService,
  getSupportRequestService,
  listSupportRequestsService,
  replySupportRequestService,
  supportRequestSummaryService,
  updateSupportRequestService,
} from '../services/supportRequest/supportRequestService.js';

const send = (res, result) => {
  res.status(result.status).json(result.body);
};

const handle = (fn) => async (req, res, next) => {
  try {
    send(res, await fn(req));
  } catch (error) {
    next(error);
  }
};

export const listSupportRequests = handle((req) => listSupportRequestsService(req.user._id, req.query || {}));
export const getSupportRequestSummary = handle((req) => supportRequestSummaryService(req.user._id));
export const getSupportRequest = handle((req) => getSupportRequestService(req.user._id, req.params.id));
export const updateSupportRequest = handle((req) => updateSupportRequestService(req.user._id, req.params.id, req.body || {}));
export const addSupportRequestNote = handle((req) => addSupportRequestNoteService(req.user._id, req.params.id, req.body || {}));
export const deleteSupportRequestNote = handle((req) => deleteSupportRequestNoteService(req.user._id, req.params.id, req.params.noteId));
export const replySupportRequest = handle((req) => replySupportRequestService(req.user, req.params.id, req.body || {}));
export const deleteSupportRequest = handle((req) => deleteSupportRequestService(req.user._id, req.params.id));
