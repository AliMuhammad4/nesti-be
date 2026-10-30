import { deleteLeadDocument, listLeadDocuments } from '../services/chat/documents/chatDocumentService.js';
import { findOwnedVisibleLeadMatch, handleLeadServiceError } from '../services/lead/leadQueryUtils.js';

export async function getLeadDocuments(req, res, next) {
  try {
    const lead = await findOwnedVisibleLeadMatch(req.user._id, req.params.id);
    const documents = await listLeadDocuments(req.user._id, lead._id);
    return res.json({ success: true, documents });
  } catch (error) {
    return handleLeadServiceError(res, error, next);
  }
}

export async function removeLeadDocument(req, res, next) {
  try {
    const lead = await findOwnedVisibleLeadMatch(req.user._id, req.params.id);
    const removed = await deleteLeadDocument(req.user._id, lead._id, req.params.docId);
    if (!removed) return res.status(404).json({ success: false, message: 'Document not found' });
    return res.json({ success: true });
  } catch (error) {
    return handleLeadServiceError(res, error, next);
  }
}
