import { handleChatService } from '../services/chatService.js';

export const handleChat = async (req, res, next) => {
  try {
    const { id, message, embedToken, visitorId, agentType, channel, formContact } = req.body;

    // Capture request metadata for attribution
    const clientIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      '';
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.headers['referrer'] || '';

    const result = await handleChatService({
      id,
      message,
      embedToken,
      visitorId,
      agentType,
      channel,
      clientIp,
      userAgent,
      referer,
      formContact,   // structured contact from the frontend form (name, email, phone)
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};
