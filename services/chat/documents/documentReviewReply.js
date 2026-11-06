import { replyLanguage } from '../../professionalAssistant/replyStyle.js';
import { textIsKnown } from './documentPromptText.js';
import {
  DOCUMENT_REVIEW,
  documentCoversRequest,
  localizedDocumentName,
} from './documentCoverage.js';
import {
  alreadyRequestedDocumentIds,
  documentRequestIds,
  followUpSkipIds,
  nextDocumentRequest,
  requestContext,
} from './documentRequestFlow.js';

export function isSameChatDocument(existing, incoming) {
  if (!existing || !incoming) return false;
  if (existing === incoming) return false;
  const existingId = String(existing._id || existing.id || '');
  const incomingId = String(incoming._id || incoming.id || '');
  if (existingId && incomingId && existingId === incomingId) return true;
  const existingHash = String(existing.content_hash || '');
  const incomingHash = String(incoming.content_hash || '');
  if (existingHash && incomingHash && existingHash === incomingHash) return true;
  if (existingHash || incomingHash) return false;
  const storedName = String(existing.original_filename || '').trim().toLowerCase();
  const incomingName = String(incoming.original_filename || incoming.filename || '').trim().toLowerCase();
  const storedBytes = Number(existing.bytes) || 0;
  const incomingBytes = Number(incoming.bytes) || 0;
  return Boolean(storedName && storedName === incomingName && storedBytes > 0 && storedBytes === incomingBytes);
}

export function documentReviewReply(documents = [], setting = null, context = {}) {
  const fresh = (Array.isArray(documents) ? documents : []).filter(Boolean);
  if (!fresh.length || !setting?.applied || !setting.document_requests?.length) return '';
  const prior = Array.isArray(context.priorDocuments) ? context.priorDocuments : [];
  const language = replyLanguage(setting, context.userMessage, context.conversationText);
  const copy = DOCUMENT_REVIEW[language] || DOCUMENT_REVIEW.english;
  const requestContextValue = requestContext(context);
  const name = (id) => localizedDocumentName(id, language);

  // Review every attachment in the turn (not only the last). Duplicates of prior uploads are noted separately.
  const novel = [];
  let allRepeated = true;
  for (const doc of fresh) {
    if (prior.some((item) => isSameChatDocument(item, doc))) continue;
    allRepeated = false;
    novel.push(doc);
  }
  if (allRepeated) {
    const next = nextDocumentRequest(setting, prior, requestContextValue);
    const say = copy.duplicate || DOCUMENT_REVIEW.english.duplicate;
    return say(next ? name(next.id) : '');
  }

  // Wait until each new file has finished reading; otherwise fall through to the still-reading path.
  if (novel.some((doc) => !textIsKnown(doc))) return '';

  const expected = nextDocumentRequest(setting, prior, requestContextValue);
  const requestIds = documentRequestIds(setting, requestContextValue);
  const matched = [];
  for (const doc of novel) {
    for (const id of requestIds) {
      if (documentCoversRequest(doc, id) && !matched.includes(id)) matched.push(id);
    }
  }
  const after = [...prior, ...novel];
  const skip = new Set([
    ...followUpSkipIds(setting, after, requestContextValue, context.history, context.previousReply),
    ...alreadyRequestedDocumentIds(setting, requestContextValue, context.history, context.previousReply),
  ]);
  // Only advance past the outstanding request when none of this turn's files covered it.
  if (expected && !matched.includes(expected.id)) skip.add(expected.id);
  const next = nextDocumentRequest(setting, after, requestContextValue, [...skip]);
  if (expected && matched.includes(expected.id)) {
    return next ? copy.exactNext(name(expected.id), name(next.id)) : copy.exactDone(name(expected.id));
  }
  if (matched.length) {
    const got = matched[0];
    return next ? copy.other(name(got), name(next.id)) : copy.other(name(got));
  }
  if (expected) return copy.different(next ? name(next.id) : '');
  return next ? copy.received() : copy.receivedDone();
}
