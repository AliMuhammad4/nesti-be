export function supportsDirectCall(thread, participants = []) {
  const threadType = String(thread?.thread_type || 'dm');
  if (threadType === 'dm') return true;
  const participantsKey = String(thread?.participants_key || '');
  return participantsKey.startsWith('lead:') && participants.length === 2;
}

export function callScopeForThread(thread, participants = []) {
  return supportsDirectCall(thread, participants) ? 'direct' : 'multiparty';
}

export function supportsCall(thread, participants = []) {
  const threadType = String(thread?.thread_type || 'dm');
  return (threadType === 'dm' || threadType === 'group') && participants.length >= 2;
}
