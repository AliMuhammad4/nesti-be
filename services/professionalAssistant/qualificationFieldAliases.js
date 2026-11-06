/**
 * Qualification question-id <-> stored lead/form field aliases.
 * Catalog question ids and LeadProfile field names stay unchanged; normalize only at read boundaries.
 * Counterpart: frontend/src/components/chatbot/agentFormQuestionMap.js (QUALIFICATION_FIELD_ALIASES).
 */
export const QUALIFICATION_FIELD_ALIASES = Object.freeze({
  down_payment: 'down_payment_readiness',
});

export const QUALIFICATION_STORED_TO_QUESTION = Object.freeze(
  Object.fromEntries(
    Object.entries(QUALIFICATION_FIELD_ALIASES).map(([questionId, storedField]) => [storedField, questionId]),
  ),
);

/** Preferred stored field for a catalog question id (or the id itself when unaliased). */
export function storedFieldForQuestionId(questionId) {
  const id = String(questionId || '').trim();
  return QUALIFICATION_FIELD_ALIASES[id] || id;
}

/** Catalog question id for a stored field (or the field itself when unaliased). */
export function questionIdForStoredField(storedField) {
  const field = String(storedField || '').trim();
  return QUALIFICATION_STORED_TO_QUESTION[field] || field;
}

/** Keys to try on a form/details object for a question id: stored field first, then question id. */
export function qualificationAliasKeys(questionId) {
  const id = String(questionId || '').trim();
  if (!id) return [];
  const stored = QUALIFICATION_FIELD_ALIASES[id];
  if (stored) return [stored, id];
  const question = QUALIFICATION_STORED_TO_QUESTION[id];
  if (question) return [id, question];
  return [id];
}

/**
 * Read a qualification value accepting either the stored field or question-id key.
 * Truthiness matches prior `stored || questionId` call sites.
 */
export function readQualificationAlias(source, questionOrStoredId = 'down_payment') {
  if (!source || typeof source !== 'object') return undefined;
  const keys = qualificationAliasKeys(questionOrStoredId);
  let last;
  for (const key of keys) {
    last = source[key];
    if (last) return last;
  }
  return last;
}

/** First truthy aliased value across sources (same as `a || b || c` over each source's alias pair). */
export function readQualificationAliasFrom(questionOrStoredId, ...sources) {
  let last;
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const value = readQualificationAlias(source, questionOrStoredId);
    if (value) return value;
    last = value;
  }
  return last;
}
