export function truthyQueryFlag(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

export function includeConversionInLeadDetail(query = {}) {
  const v = query.include_conversion;
  if (v === undefined || v === null || String(v).trim() === '') return true;
  return truthyQueryFlag(v);
}

export const ICP_TIERS = new Set(['perfect_match', 'good_match', 'low_match']);
