import { lawyerReplyDrifted, buildPreviewChatPrompt } from '../../professionalAssistant/professionalAssistantService.js';
import {
  buildSharedDocumentsPrompt,
  loadConversationDocuments,
  rereadUndescribedImages,
  resumeDocumentReads,
  waitForDocumentReads,
  waitForDocumentSummaries,
} from '../documents/chatDocumentService.js';

async function reloadDocuments(query) {
  return loadConversationDocuments(query);
}

/** Wait out a restart, then build the prompt section for files in this turn. */
export async function prepareTurnDocuments({
  landingMode,
  userId,
  conversation,
  sessionId,
  previewForOwner,
  turnAttachments,
  trimmedMessage,
  flow,
  professionalProfile,
  systemPromptOptions,
  history,
}) {
  const query = {
    userId,
    conversationId: conversation._id,
    sessionId,
    includePreview: previewForOwner,
  };
  let sharedDocuments = landingMode ? [] : await reloadDocuments(query);
  const unfinishedDocuments = sharedDocuments.filter((doc) => doc.status !== 'ready' && doc.status !== 'failed');
  if (unfinishedDocuments.length) {
    await resumeDocumentReads(unfinishedDocuments);
    await waitForDocumentReads(unfinishedDocuments.map((doc) => doc._id));
    sharedDocuments = await reloadDocuments(query);
  }
  const focusIdsForRead = new Set(turnAttachments.map((file) => String(file.id)));
  const photosToReread = focusIdsForRead.size
    ? sharedDocuments.filter((doc) => focusIdsForRead.has(String(doc._id)))
    : [];
  if (photosToReread.length && await rereadUndescribedImages(photosToReread)) {
    sharedDocuments = await reloadDocuments(query);
  }
  const focusIds = new Set(turnAttachments.map((file) => String(file.id)));
  let focusedDocuments = focusIds.size
    ? sharedDocuments.filter((doc) => focusIds.has(String(doc._id)))
    : [];
  if (focusedDocuments.some((doc) => doc.text_ready && doc.status !== 'ready' && doc.status !== 'failed')) {
    await waitForDocumentSummaries(focusedDocuments.map((doc) => doc._id), 8000);
    sharedDocuments = await reloadDocuments(query);
    focusedDocuments = sharedDocuments.filter((doc) => focusIds.has(String(doc._id)));
  }
  const documentPrompt = buildSharedDocumentsPrompt(sharedDocuments, {
    focusIds: turnAttachments.map((file) => file.id),
    question: trimmedMessage,
  });
  const newFileNames = turnAttachments.map((file) => file.original_filename).filter(Boolean).join(', ');
  const systemPrompt = `${previewForOwner
    ? buildPreviewChatPrompt(flow?.flowRole, professionalProfile, systemPromptOptions)
    : flow.buildSystemPrompt(professionalProfile, systemPromptOptions)}${documentPrompt ? `\n\n${documentPrompt}` : ''}`;
  const recentHistory = previewForOwner ? history.slice(-6) : history;
  const promptHistory = flow?.flowRole !== 'lawyer'
    ? recentHistory
    : recentHistory.filter((message) => message.role !== 'assistant' || !lawyerReplyDrifted(message.content));
  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...promptHistory.map((m) => ({ role: m.role, content: m.content })),
  ];
  return {
    sharedDocuments,
    focusIds,
    focusedDocuments,
    documentPrompt,
    newFileNames,
    systemPrompt,
    openaiMessages,
  };
}
