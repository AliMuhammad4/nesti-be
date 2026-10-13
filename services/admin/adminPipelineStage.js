export const ADMIN_PIPELINE_STAGES = ['new', 'calling', 'ready'];

function text(value) {
  return String(value || '').trim();
}

export function cleanDisplayText(value) {
  return text(value)
    .replace(/\[\[plans\]\]/gi, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
      text: cleanDisplayText(item?.text),
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
  const visitor = [...lines].reverse().find((item) => item.role === 'user');
  return cleanDisplayText(visitor?.text || (lines.length ? lines[lines.length - 1].text : '') || row?.message);
}

export function deriveAdminPipelineStage(row) {
  if (['interested', 'plan_recommended'].includes(text(row?.voice_outcome))) {
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
  if (row?.close_outcome === 'lost') return 'closed';
  if (row?.close_outcome === 'won') return 'ready';
  const stored = text(row?.pipeline_stage);
  if (ADMIN_PIPELINE_STAGES.includes(stored)) return stored;
  return deriveAdminPipelineStage(row);
}

export function leadStatus(row) {
  if (row?.close_outcome === 'won') return 'joined';
  if (row?.close_outcome === 'lost') return 'nurture';
  return 'open';
}

export function recommendedAdminLeadAction(row) {
  if (row?.close_outcome === 'won' || row?.on_plan) {
    return {
      title: 'Confirm onboarding',
      timing: 'Already subscribed',
      detail: 'Confirm they can access the plan they chose and know how to get started.',
    };
  }
  if (row?.close_outcome === 'lost' || row?.voice_outcome === 'declined') {
    return {
      title: 'Continue nurture',
      timing: 'Do not place another immediate sales call',
      detail: 'Respect their timing. Send requested information and call again only if they ask or agree to a follow-up.',
    };
  }
  if (row?.voice_outcome === 'callback') {
    return {
      title: 'Honor the callback',
      timing: 'At the agreed time; confirm a time today if none was recorded',
      detail: 'Use the previous call note to resume the conversation, then capture the next outcome.',
    };
  }
  if (row?.voice_outcome === 'interested' || row?.voice_outcome === 'plan_recommended') {
    return {
      title: 'Help them choose a plan',
      timing: 'Follow up today',
      detail: 'Address the remaining question, explain the recommended plan, and guide them to subscribe. Mark joined only after a subscription is confirmed.',
    };
  }

  const source = text(row?.source);
  const grade = text(row?.lead_grade).toLowerCase();
  const responseMinutes = source === 'direct_inquiry'
    ? 30
    : grade === 'hot'
      ? 5
      : grade === 'warm'
        ? 30
        : 120;
  if (!text(row?.phone)) {
    return {
      title: 'Reply by email',
      timing: 'Now',
      detail: source === 'direct_inquiry'
        ? 'Answer the written request directly and offer a call if they would like to discuss it.'
        : 'Reference what they asked in chat, answer their question, and offer a call if they would like a walkthrough.',
    };
  }
  return {
    title: 'Call this lead',
    timing: `Within ${responseMinutes} minutes of ${source === 'direct_inquiry' ? 'the inquiry' : 'their latest chat'}`,
    detail: source === 'direct_inquiry'
      ? 'Reference the written request, clarify what they need, and offer the matching plan or a walkthrough.'
      : 'Reference their latest question, explain the relevant plan, and ask whether they are ready to subscribe.',
  };
}

export function reopenNurtureLead(row, at = new Date()) {
  if (row?.close_outcome !== 'lost') return false;
  row.close_outcome = '';
  row.close_note = '';
  row.closed_at = null;
  row.pipeline_stage = 'calling';
  row.status = 'contacted';
  row.reopen_count = Number(row.reopen_count || 0) + 1;
  row.reopened_at = at;
  return true;
}

export function nextAutoPipelineStage(row) {
  const stored = text(row?.pipeline_stage);
  if (stored === 'ready') return 'ready';
  const derived = deriveAdminPipelineStage(row);
  if (stored === 'calling' && derived === 'new') return 'calling';
  return derived;
}

export function fieldsForVoiceOutcome(outcome, row) {
  const value = text(outcome);
  const stage = text(row?.pipeline_stage);
  if (value === 'interested' || value === 'plan_recommended') {
    return { pipeline_stage: 'ready' };
  }
  if (value === 'callback') {
    if (stage === 'ready') return {};
    return { pipeline_stage: 'calling' };
  }
  if (value === 'declined') {
    return {
      close_outcome: 'lost',
      status: 'resolved',
      closed_at: new Date(),
    };
  }
  return {};
}
