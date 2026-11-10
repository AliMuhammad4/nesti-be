/** Public chat-document API. Implementation lives in sibling modules under documents/. */

export { MAX_DOCUMENT_PAGES, sniffChatFile, extractTextFromUpload, textFromLegacyDoc, countDocumentPages, assertChatDocumentLimits } from './documentFileKind.js';

export {
  hasReadableDocumentText,
  documentReadReply,
  relevantDocumentPassages,
  buildSharedDocumentsPrompt,
  waitForDocumentReads,
  waitForDocumentSummaries,
  briefDocumentAnswer,
} from './documentPromptText.js';

export {
  intakeHasPropertyImages,
  documentRequestIds,
  nextDocumentRequest,
  followUpSkipIds,
  requestNamedInReply,
} from './documentRequestFlow.js';

export { isSameChatDocument, documentReviewReply } from './documentReviewReply.js';

export { requestDocumentForReply, applyDocumentAsk } from './documentAsk.js';

export {
  rereadUndescribedImages,
  resumeDocumentReads,
  readChatDocument,
} from './documentReadJobs.js';

export {
  countConversationDocuments,
  saveChatDocument,
  signStoredAttachments,
  publicDocumentView,
  loadConversationDocuments,
  attachDocumentsToTurn,
  leadDocumentLinkFilter,
  linkConversationDocumentsToLead,
  listLeadDocuments,
  deleteLeadDocument,
} from './documentStore.js';
