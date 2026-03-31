const FINANCING_PHRASE =
  /fully_pre_approved|partially_pre_approved|not_pre_approved|pre_approved|pre-?approv|preapprov|cash buyer|^cash$|financing in progress|financing status|not yet pre|mortgage status/i;
export function partitionBuyerBudgetInputs(...candidates) {
  const list = candidates
    .flat()
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).trim());

  let budgetStr = '';
  let financingStr = '';

  for (const s of list) {
    const n = parseInventoryPrice(s) || parseMaxBudget(s);
    if (n != null && Number.isFinite(n) && n > 0) {
      budgetStr = budgetStr || s;
    }
  }

  for (const s of list) {
    const n = parseInventoryPrice(s) || parseMaxBudget(s);
    if (n != null && Number.isFinite(n) && n > 0) continue;
    if (FINANCING_PHRASE.test(s)) financingStr = financingStr || s;
  }

  if (!budgetStr) {
    for (const s of list) {
      const n = parseInventoryPrice(s) || parseMaxBudget(s);
      if (n != null && Number.isFinite(n) && n > 0) continue;
      if (FINANCING_PHRASE.test(s)) continue;
      budgetStr = s;
      break;
    }
  }

  return { budgetStr, financingStr };
}

export const parseMaxBudget = (str) => {
  if (!str) return null;
  const s = String(str).toLowerCase().replace(/,/g, ' ');
  const range = s.match(/(\d[\d.]*)\s*[-–to]+\s*(\d[\d.]*)\s*k/i);
  if (range) return Math.max(parseFloat(range[1]), parseFloat(range[2])) * 1000;
  const k = s.match(/\$?\s*([\d.]+)\s*k\b/i);
  if (k) return parseFloat(k[1]) * 1000;
  const m = s.match(/\$?\s*([\d.]+)\s*m\b/i);
  if (m) return parseFloat(m[1]) * 1_000_000;
  const plain = s.match(/\$?\s*([\d]{4,})/);
  if (plain) return parseInt(plain[1], 10);
  return null;
};

export const parseInventoryPrice = (str) => {
  if (!str) return 0;
  const raw = String(str).replace(/,/g, '').trim();
  const hyphenRange = raw.match(/(\d[\d.]*)\s*[-–]\s*(\d[\d.]*)/);
  if (hyphenRange) {
    const a = parseFloat(hyphenRange[1]);
    const b = parseFloat(hyphenRange[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const hi = Math.max(a, b);
      if (hi >= 10_000) return hi;
    }
  }
  const maxB = parseMaxBudget(str);
  if (maxB != null && maxB > 0) return maxB;
  const nums = raw.match(/\d[\d.]*/g);
  if (!nums?.length) return 0;
  return Math.max(...nums.map((n) => parseFloat(n)).filter((n) => Number.isFinite(n) && n > 0));
};
