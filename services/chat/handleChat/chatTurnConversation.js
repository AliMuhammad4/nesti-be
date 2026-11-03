import crypto from 'crypto';

export function asFormContactRecord(formContact) {
  return formContact && typeof formContact === 'object' && !Array.isArray(formContact) ? formContact : {};
}

export function intakeSessionId() {
  return `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function conversationCreateFields({
  sessionId,
  userId,
  visitor,
  embed,
  embedToken,
  embedFlowRole,
  agentType,
  channel,
  intent,
}) {
  return {
    session_id: sessionId,
    user_id: userId,
    visitor_id: visitor._id,
    embed_id: embed._id,
    embed_token: embedToken,
    embed_flow_role: embedFlowRole,
    agent_type: agentType,
    channel,
    intent,
  };
}
