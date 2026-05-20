export function truthyQueryFlag(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

export const ICP_TIERS = new Set(['perfect_match', 'good_match', 'low_match']);
