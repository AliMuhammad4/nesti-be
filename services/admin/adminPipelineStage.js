export const ADMIN_PIPELINE_STAGES = ['new', 'calling', 'ready'];

function text(value) {
  return String(value || '').trim();
}

function isHiddenOpening(value) {
  const raw = text(value);
  return raw.startsWith('My name, email, and mobile are already saved')
    || (raw.startsWith('This is ') && raw.includes('Greet them by name as Ravi'));
}

export function visibleTranscript(row) {
  return (Array.isArray(row?.transcript) ? row.transcript : [])
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      text: text(item?.text),
    }))
    .filter((item) => item.text && !isHiddenOpening(item.text));
}

export function userChatTurns(row) {
  return visibleTranscript(row).filter((item) => item.role === 'user').length;
}

export function hasLiveConversation(row) {
  if (text(row?.source) !== 'landing_chat') return false;
  if (userChatTurns(row) > 0) return true;
  return Number(row?.chat_state?.turns || 0) > 1;
}

export function lastVisibleMessage(row) {
  const lines = visibleTranscript(row);
  return lines.length ? lines[lines.length - 1].text : text(row?.message);
}

export function deriveAdminPipelineStage(row) {
  if (row?.close_outcome === 'won' || ['interested', 'plan_recommended'].includes(text(row?.voice_outcome))) {
    return 'ready';
  }
  if (
    row?.status === 'contacted'
    || text(row?.voice_outcome) === 'callback'
    || hasLiveConversation(row)
  ) {
    return 'calling';
  }
  return 'new';
}

export function resolveAdminPipelineStage(row) {
  const stored = text(row?.pipeline_stage);
  if (ADMIN_PIPELINE_STAGES.includes(stored)) return stored;
  return deriveAdminPipelineStage(row);
}

export function nextAutoPipelineStage(row) {
  const stored = text(row?.pipeline_stage);
  if (stored === 'ready') return 'ready';
  const derived = deriveAdminPipelineStage(row);
  if (stored === 'calling' && derived === 'new') return 'calling';
  return derived;
}
