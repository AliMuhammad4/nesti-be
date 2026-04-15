import logger from '../../../utils/logger.js';
const KNOWN_CITIES = [
  'lahore', 'karachi', 'islamabad', 'clifton', 'dha', 'london',
  'dubai', 'new york', 'miami', 'los angeles', 'chicago', 'toronto',
];
export const GRADE_ORDER = { hot: 4, warm: 3, interested: 2, cold: 1, unscored: 0 };
export const extractSignals = (message = '') => {
  const text = String(message || '').toLowerCase();
  let timeline = null;
  if (/asap|immediately|right away|as soon as possible|urgent/.test(text)) {
    timeline = 'asap';
  } else if (/\b(1|one|2|two|3|three)\s*(week|month)s?\b/.test(text)) {
    timeline = '1-3 months';
  } else if (/\b(3|three|4|four|5|five|6|six)\s*month/.test(text)) {
    timeline = '3-6 months';
  } else if (/6.{0,5}month|half a year|6-12 months|within a year/i.test(text)) {
    timeline = '6-12 months';
  } else if (/\byear\b|12 month|next year|just browsing/i.test(text)) {
    timeline = 'browsing';
  }
  let budget = null;
  let financing_signal = null;
  if (/pre.?approv|fully\s*pre|financing\s*approv/i.test(text)) {
    financing_signal = 'pre_approved';
  } else if (/cash buyer|all\s*-?\s*cash|paying cash|buying with cash/i.test(text)) {
    financing_signal = 'cash';
  }
  const m = text.match(/\$?([\d,]+)\s*(k|thousand|m|million)?/i);
  if (m) {
    let amount = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'k' || unit === 'thousand') amount *= 1_000;
    if (unit === 'm' || unit === 'million') amount *= 1_000_000;
    if (amount >= 1_000) {
      budget = amount >= 1_000_000
        ? `$${(amount / 1_000_000).toFixed(1)}M`
        : `$${Math.round(amount / 1_000)}K`;
    }
  }
  if (financing_signal && budget) {
    logger.debug('extractSignals: text has both financing hint and dollar budget', { financing_signal });
  }
  const bedsM  = text.match(/(\d+)\s*(?:bed(?:room)?s?|br)\b/);
  const bathsM = text.match(/(\d+)\s*(?:bath(?:room)?s?|ba)\b/);
  const beds   = bedsM  ? parseInt(bedsM[1],  10) : null;
  const baths  = bathsM ? parseInt(bathsM[1], 10) : null;
  const areaM = text.match(/(\d[\d,]*)\s*(?:sq\.?\s*ft|square\s*feet|sqft|marla)/i);
  const area  = areaM ? `${areaM[1].replace(/,/g, '')} SQFT` : null;
  let location = null;
  const inM = String(message || '').match(/\bin\s+([A-Z][a-zA-Z\s]{2,40})/);
  if (inM) {
    location = inM[1].trim();
  } else {
    for (const city of KNOWN_CITIES) {
      if (text.includes(city)) {
        location = city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }
  }
  return { timeline, budget, financing_signal, beds, baths, area, location };
};

const takeIfPresent = (patch, base, key) => {
  if (!patch) return base?.[key] ?? null;
  const v = patch[key];
  if (v === undefined || v === null || v === '') return base?.[key] ?? null;
  return v;
};
export const mergeSignals = (base, patch) => ({
  timeline:         takeIfPresent(patch, base, 'timeline'),
  budget:           takeIfPresent(patch, base, 'budget'),
  financing_signal: takeIfPresent(patch, base, 'financing_signal'),
  beds:             takeIfPresent(patch, base, 'beds'),
  baths:            takeIfPresent(patch, base, 'baths'),
  area:             takeIfPresent(patch, base, 'area'),
  location:         takeIfPresent(patch, base, 'location'),
});
export const buildLeadType = (grade, intent) =>
  `${grade}_${intent === 'sell' ? 'seller' : 'buyer'}`;
export const buildMortgageBrokerLeadType = (grade) => `${grade}_client`;
export const buildLeadClassification = (grade, intent) => {
  const label = grade.charAt(0).toUpperCase() + grade.slice(1);
  const i = intent === 'sell' ? 'Seller' : 'Buyer';
  return `${label} ${i}`;
};
