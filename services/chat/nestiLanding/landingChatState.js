function text(value) {
  return String(value || '').trim();
}

export function emptyChatState() {
  return {
    pain_point: '',
    feature: '',
    features_explained: [],
    questions_asked: [],
    turns: 0,
  };
}

export function readChatState(row) {
  const source = row?.chat_state || {};
  return {
    pain_point: text(source.pain_point),
    feature: text(source.feature),
    features_explained: Array.isArray(source.features_explained) ? source.features_explained.map(text).filter(Boolean) : [],
    questions_asked: Array.isArray(source.questions_asked) ? source.questions_asked.map(text).filter(Boolean) : [],
    turns: Number(source.turns) || 0,
  };
}

export function questionFromReply(value) {
  const sentences = text(value).split(/(?<=[.!?])\s+/).map(text).filter(Boolean);
  const asked = [...sentences].reverse().find((sentence) => /\?\s*$/.test(sentence));
  return asked ? asked.slice(0, 240) : '';
}

export function nextChatState(current, { pain, feature, question } = {}) {
  const state = current || emptyChatState();
  const features = [...state.features_explained];
  const nextFeature = text(feature);
  if (nextFeature && !features.includes(nextFeature)) features.push(nextFeature);
  const questions = [...state.questions_asked];
  const nextQuestion = text(question);
  if (nextQuestion && !questions.includes(nextQuestion)) questions.push(nextQuestion);
  return {
    pain_point: text(pain?.id) || state.pain_point,
    feature: nextFeature || state.feature,
    features_explained: features.slice(-12),
    questions_asked: questions.slice(-8),
    turns: (Number(state.turns) || 0) + 1,
  };
}

export function appendChatEvents(existing, entries) {
  const events = Array.isArray(existing) ? existing.slice() : [];
  entries.filter(Boolean).forEach((entry) => {
    events.push({
      type: text(entry.type).slice(0, 40),
      detail: text(entry.detail).slice(0, 120),
      at: entry.at || new Date(),
    });
  });
  return events.slice(-40);
}
