import ChatConversation from '../../../models/ChatConversation.js';

export async function appendRun(conversationId, entry) {
  await ChatConversation.findByIdAndUpdate(conversationId, {
    $push: { post_booking_automation_runs: entry },
  });
}

export function alreadyRan(conversation, key, dedupe) {
  const runs = conversation.post_booking_automation_runs || [];
  return runs.some((r) => r.key === key && r.dedupe_key === dedupe);
}
