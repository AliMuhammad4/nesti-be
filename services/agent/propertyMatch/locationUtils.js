const norm = (s) => String(s || '').toLowerCase().trim();

export const normalizeAddrKey = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const rowMatchesSellerAddress = (sellerLine, row) => {
  const sellerKey = normalizeAddrKey(sellerLine);
  if (sellerKey.length < 10) return false;
  const rowKey = normalizeAddrKey(`${row.address || ''} ${row.location || ''}`);
  if (rowKey.length < 8) return false;
  if (sellerKey === rowKey) return true;
  if (rowKey.includes(sellerKey)) return true;
  if (sellerKey.includes(rowKey) && rowKey.length >= 14) return true;
  const sellerTokens = sellerKey.split(' ').filter((t) => t.length >= 3);
  if (sellerTokens.length < 2) return false;
  const hits = sellerTokens.filter((t) => rowKey.includes(t)).length;
  return hits >= Math.ceil(sellerTokens.length * 0.7) && hits >= 2;
};

const locationTokens = (text) => {
  const t = norm(text);
  if (!t) return [];
  return t.split(/[\s,]+/).filter((w) => w.length > 2);
};

export const locationOverlaps = (leadLoc, propLoc, propAddr) => {
  const lead = norm(leadLoc);
  if (!lead) return true;
  const hay = `${norm(propLoc)} ${norm(propAddr)}`;
  if (!hay.trim()) return true;
  if (hay.includes(lead)) return true;
  const tokens = locationTokens(leadLoc);
  return tokens.some((tok) => hay.includes(tok));
};

export { norm };
