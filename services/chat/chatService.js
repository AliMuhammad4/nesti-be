import crypto from 'crypto';
import ChatbotEmbedUrl from '../../models/ChatbotEmbedUrl.js';
import { normalizeAgentType } from './utils/normalizationUtils.js';
import { allowLandingChatRate, isLandingEmbed, loadLandingChatSettings } from './nestiLanding/landingChatConfig.js';
import { handleLandingChatTurn } from './nestiLanding/landingChatTurnService.js';
import { prepareProfessionalChatTurn } from './handleChat/chatTurnPrepare.js';
import { draftProfessionalChatReply } from './handleChat/chatReplyDraft.js';
import { finishProfessionalChatTurn } from './handleChat/chatTurnFinish.js';

export { flowTypeForConversation, recomputeSignalsForPropertyMatches } from './handleChat/index.js';
export {
  getChatSessionMessagesService,
  handlePropertyMatchesService,
  selectChatPropertyMatchService,
  clearChatSessionService,
} from './handleChat/chatSessionQueries.js';

export const handleChatService = async ({
  id,
  message,
  embedToken,
  visitorId,
  agentType,
  channel,
  clientIp,
  userAgent,
  referer,
  formContact,
  forceNewLead = false,
  opening = false,
  preview = false,
  previewAssistantDraft = null,
  testPersona = null,
  viewerUserId = null,
  onReplyDelta = null,
  attachmentIds = [],
  leadProfilePreview = null,
}) => {
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { status: 400, body: { success: false, message: 'message is required' } };
  }
  if (!embedToken) {
    return { status: 400, body: { success: false, message: 'embedToken is required' } };
  }
  if (message.length > 10_000) {
    return { status: 400, body: { success: false, message: 'message exceeds 10,000 characters' } };
  }

  const trimmedMessage = message.trim();
  const sessionId = id || crypto.randomBytes(8).toString('hex');
  const normalizedAgentType = normalizeAgentType(agentType);
  const normalizedChannel = channel || 'web';

  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return { status: 403, body: { success: false, message: 'Invalid or inactive embed token' } };
  }
  if (isLandingEmbed(embed) || normalizedChannel === 'landing') {
    return handleLandingChatTurn({
      message: trimmedMessage,
      embedToken,
      sessionId,
      visitorId,
      clientIp,
      formContact,
      opening: Boolean(opening),
    });
  }
  const landingMode = isLandingEmbed(embed);
  if (landingMode && !allowLandingChatRate(clientIp, visitorId)) {
    return { status: 429, body: { success: false, message: 'Too many messages. Try again in a minute.' } };
  }
  const landingSettings = landingMode ? await loadLandingChatSettings().catch(() => null) : null;
  if (landingMode && landingSettings && landingSettings.enabled === false) {
    return { status: 403, body: { success: false, message: 'Landing chat is turned off.' } };
  }

  const prepared = await prepareProfessionalChatTurn({
    embed,
    trimmedMessage,
    sessionId,
    normalizedAgentType,
    normalizedChannel,
    visitorId,
    userAgent,
    clientIp,
    referer,
    preview,
    viewerUserId,
    previewAssistantDraft,
    testPersona,
    formContact,
    forceNewLead,
    attachmentIds,
    leadProfilePreview,
    landingMode,
    landingSettings,
    embedToken,
    onReplyDelta,
  });
  if (prepared.response) return prepared.response;

  const drafted = await draftProfessionalChatReply(prepared.state);
  if (drafted.response) return drafted.response;

  return finishProfessionalChatTurn(prepared.state, drafted.patch);
};
