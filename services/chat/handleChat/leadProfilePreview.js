/**
 * Intake summary card (LeadProfileUserBubble) for the first user message: { headline, paragraphs, summary }.
 * Saved on the user message meta (like selected_property) so the card survives a reload; never part of the
 * form data or the prompt.
 */

const MAX_HEADLINE = 120;
const MAX_PARAGRAPHS = 8;
const MAX_PARAGRAPH = 600;
const MAX_SUMMARY = 2000;

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Sanitized card, or null when there is nothing to show. */
export function sanitizeLeadProfilePreview(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const headline = clip(raw.headline, MAX_HEADLINE);
  const paragraphs = Array.isArray(raw.paragraphs)
    ? raw.paragraphs.map((p) => clip(p, MAX_PARAGRAPH)).filter(Boolean).slice(0, MAX_PARAGRAPHS)
    : [];
  if (!headline && !paragraphs.length) return null;
  const summary = String(raw.summary ?? '').trim().slice(0, MAX_SUMMARY);
  return { headline, paragraphs, ...(summary ? { summary } : {}) };
}

/** Card stored on a message meta, for the history APIs (null when absent or malformed). */
export function leadProfilePreviewFromMeta(meta) {
  return sanitizeLeadProfilePreview(meta?.lead_profile_preview);
}
