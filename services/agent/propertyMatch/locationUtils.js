import { CA_PROVINCES, US_STATES } from '../../professionalAssistant/brokerInvestorMarket.js';

const norm = (s) => String(s || '').toLowerCase().trim();

const REGION_NAMES = [...Object.values(CA_PROVINCES), ...Object.values(US_STATES)]
  .map((name) => name.toLowerCase())
  .sort((a, b) => b.length - a.length);
const REGION_CODE_BY_NAME = Object.fromEntries(
  [...Object.entries(CA_PROVINCES), ...Object.entries(US_STATES)].map(([code, name]) => [name.toLowerCase(), code.toLowerCase()]),
);
const COUNTRY_PHRASE_RE = /\b(united states of america|united states|u\.s\.a?\.?|usa|america|canada)\b/g;
const GENERIC_AREA_TOKENS = new Set(['city', 'town', 'area', 'county', 'province', 'state', 'territory', 'the', 'and', 'near', 'around', 'other', 'downtown']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

export const splitLeadArea = (leadLoc) => {
  let rest = norm(leadLoc).replace(COUNTRY_PHRASE_RE, ' ');
  const regions = [];
  for (const name of REGION_NAMES) {
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, 'g');
    if (re.test(rest)) {
      regions.push(name);
      rest = rest.replace(re, ' ');
    }
  }
  const specific = locationTokens(rest).filter((tok) => !GENERIC_AREA_TOKENS.has(tok));
  return { specific, regions };
};

export const locationOverlaps = (leadLoc, propLoc, propAddr) => {
  const lead = norm(leadLoc);
  if (!lead) return true;
  const hay = `${norm(propLoc)} ${norm(propAddr)}`;
  if (!hay.trim()) return true;
  if (hay.includes(lead)) return true;
  const { specific, regions } = splitLeadArea(leadLoc);
  if (specific.length) return specific.some((tok) => hay.includes(tok));
  if (regions.length) {
    return regions.some((name) => hay.includes(name)
      || new RegExp(`,\\s*${REGION_CODE_BY_NAME[name]}\\b`).test(hay));
  }
  const tokens = locationTokens(leadLoc);
  return tokens.some((tok) => hay.includes(tok));
};

export { norm };
