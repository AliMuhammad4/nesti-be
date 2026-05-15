/** Terminal funnel stages: automation must not overwrite these from Calendly/booking flows. */
export const TERMINAL_MATCH_STATUSES = new Set(['converted', 'closed_lost']);

export function isTerminalMatchStatus(status) {
  return TERMINAL_MATCH_STATUSES.has(String(status || ''));
}

/** Max stored entries for `compatibility_factors.agent_notes` (append-only, oldest dropped). */
export const AGENT_NOTES_MAX_ENTRIES = 200;
