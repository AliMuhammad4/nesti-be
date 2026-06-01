function toPositiveInt(value, fallback) {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampLimit(value, { defaultLimit = 20, maxLimit = 100, minLimit = 1 } = {}) {
  const parsed = toPositiveInt(value, defaultLimit);
  return Math.min(maxLimit, Math.max(minLimit, parsed));
}

export function parsePageLimitPagination(input = {}, options = {}) {
  const page = toPositiveInt(input.page, 1);
  const limit = clampLimit(input.limit, options);
  const offset = (page - 1) * limit;
  return { page, limit, offset, skip: offset };
}

export function parseOffsetLimitPagination(input = {}, options = {}) {
  const limit = clampLimit(input.limit, options);
  const rawOffset = parseInt(String(input.offset ?? '0'), 10);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const page = Math.floor(offset / limit) + 1;
  return { offset, limit, page, skip: offset };
}

export function buildPaginationMeta({ page, limit, total }) {
  const total_pages = total > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    current_page: page,
    limit,
    total,
    total_pages,
    has_prev_page: page > 1,
    has_next_page: page < total_pages,
    has_more: page < total_pages,
  };
}

export const PAGINATION_PRESETS = {
  leadList: { defaultLimit: 20, maxLimit: 100 },
  /** Lead workspace transcript — return full thread (no practical cap). */
  leadConversation: { defaultLimit: 10_000, maxLimit: 10_000 },
  propertyMatches: { defaultLimit: 10, maxLimit: 100 },
  /** Referrals table (inbound/outbound tabs). */
  referralsList: { defaultLimit: 10, maxLimit: 100 },
};
