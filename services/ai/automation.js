import ChatConversation from '../../models/ChatConversation.js';

export const getProfessionalGuidance = () => ({
  success: true,
  insights: 'Actionable guidance based on lead data',
});

export const toggleAutomation = async ({ userId, conversationId }) => {
  const conversation = await ChatConversation.findOne({
    $or: [
      { _id: conversationId, user_id: userId },
      { session_id: conversationId, user_id: userId },
    ],
  });

  if (!conversation) {
    return { success: false, status: 404, message: 'Conversation not found' };
  }

  conversation.is_automated_booking_enabled = !conversation.is_automated_booking_enabled;
  await conversation.save();

  return {
    success: true,
    message: 'Automation toggled successfully',
    is_automated_booking_enabled: conversation.is_automated_booking_enabled,
  };
};
