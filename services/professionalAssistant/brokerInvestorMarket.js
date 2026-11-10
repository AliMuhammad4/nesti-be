/**
 * Shared Canada vs U.S. market helper (mortgage broker + real estate lawyer) and investor-financing vocabulary.
 * Single source of truth: form values, lead labels, region label, country-specific document names/order,
 * read-time market inference for older leads, and the broker investor / lawyer market prompt blocks.
 * Currency is always USD on every market (product decision); Canada keeps its own lending and legal terms.
 * Frontend counterpart (form option labels only): frontend/src/lib/brokerInvestorMarket.js
 *
 * Deliberately states no regulatory minimums (down-payment %, CMHC/insurance rules, DSCR ratios):
 * those vary by lender/program and are confirmed by the broker.
 */

export const MARKET_COUNTRIES = Object.freeze({
  CA: Object.freeze({
    code: 'CA',
    label: 'Canada',
    currency: 'USD',
    regionLabel: 'Province / territory',
  }),
  US: Object.freeze({
    code: 'US',
    label: 'United States',
    currency: 'USD',
    regionLabel: 'State',
  }),
});

export const CA_PROVINCES = Object.freeze({
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island',
  QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
});

export const US_STATES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
});

/** Investor financing path. `markets` limits where an option is offered; labels are market-specific. */
export const INVESTOR_FINANCING = Object.freeze({
  conventional_rental: { markets: ['CA', 'US'], CA: 'Rental property mortgage (bank / A lender)', US: 'Conventional investment-property loan' },
  dscr: { markets: ['US'], US: 'DSCR loan (qualifies on rental income)' },
  b_private_lender: { markets: ['CA'], CA: 'B lender or private lender' },
  hard_money_bridge: { markets: ['US'], US: 'Hard money / fix-and-flip / bridge loan' },
  portfolio: { markets: ['US'], US: 'Portfolio loan' },
  commercial_mortgage: { markets: ['CA', 'US'], CA: 'Commercial mortgage (5+ units or commercial)', US: 'Commercial loan (5+ units or commercial)' },
  refinance_equity: { markets: ['CA', 'US'], CA: 'Refinance, equity take-out, or HELOC', US: 'Cash-out refinance or HELOC' },
  cash_purchase: { markets: ['CA', 'US'], CA: 'Cash purchase (no financing)', US: 'Cash purchase (no financing)' },
  not_sure: { markets: ['CA', 'US'], CA: 'Not sure yet', US: 'Not sure yet' },
});

export const BORROWER_ENTITY = Object.freeze({
  personally: { CA: 'Personally', US: 'Personally' },
  company: { CA: 'Corporation / holding company', US: 'LLC or corporation' },
  not_sure: { CA: 'Not sure yet', US: 'Not sure yet' },
});

/** Broker investor down-payment / capital plan (investment properties need more equity than owner-occupied). */
export const INVESTOR_DOWN_PAYMENT = Object.freeze({
  cash_purchase: 'Cash purchase',
  '25_plus': '25% or more',
  '20_24': '20–24%',
  '15_19': '15–19%',
  under_15: 'Under 15%',
  not_sure: 'Not sure yet',
});

export const BROKER_INVESTMENT_TYPES = Object.freeze({
  rental_property: 'Long-term rental',
  vacation_rental: 'Short-term / vacation rental',
  multi_unit: 'Multi-unit (2–4 units)',
  commercial: 'Commercial / 5+ units',
  fix_and_flip: 'Fix and flip',
  brrrr: 'BRRRR (buy, rehab, rent, refinance)',
  pre_construction: 'Pre-construction / new build',
});

const COUNTRY_ALIASES = {
  ca: 'CA', can: 'CA', canada: 'CA',
  us: 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states': 'US', 'united states of america': 'US', america: 'US',
};

/** 'CA' | 'US' | '' from an explicit country value. */
export function normalizeMarketCountry(value) {
  const key = String(value || '').trim().toLowerCase();
  return COUNTRY_ALIASES[key] || '';
}

/** Market value the intake forms send for a country outside Canada and the U.S. */
export const OTHER_MARKET = 'other';

/** True when the visitor picked "Other country" (no CA / US inference, generic terms, free-text region and city). */
export function isOtherMarket(value) {
  return String(value || '').trim().toLowerCase() === OTHER_MARKET;
}

/** Region code for a country ('ON', 'TX') from a code or a full name. */
export function normalizeMarketRegion(value, country = '') {
  const raw = String(value || '').trim();
  if (!raw || isOtherMarket(country)) return '';
  const upper = raw.toUpperCase();
  const lists = country === 'CA' ? [CA_PROVINCES] : country === 'US' ? [US_STATES] : [CA_PROVINCES, US_STATES];
  for (const list of lists) {
    if (list[upper]) return upper;
    const hit = Object.entries(list).find(([, name]) => name.toLowerCase() === raw.toLowerCase());
    if (hit) return hit[0];
  }
  return '';
}

function countryFromRegionText(text) {
  const value = String(text || '');
  if (!value.trim()) return '';
  if (/\b(canada|canadian)\b/i.test(value)) return 'CA';
  if (/\b(usa|u\.s\.a?\.?|united states)\b/i.test(value)) return 'US';
  const lower = value.toLowerCase();
  const caName = Object.values(CA_PROVINCES).some((name) => lower.includes(name.toLowerCase()));
  // "California" contains no province name; "Washington" is checked as a U.S. state below.
  const usName = Object.values(US_STATES).some((name) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(lower));
  if (caName && !usName) return 'CA';
  if (usName && !caName) return 'US';
  // Trailing ", ON" / ", TX" style codes (avoid ambiguous CA = California vs Canada).
  const code = value.match(/,\s*([A-Z]{2})\b/)?.[1] || '';
  if (code && code !== 'CA') {
    if (CA_PROVINCES[code] && !US_STATES[code]) return 'CA';
    if (US_STATES[code] && !CA_PROVINCES[code]) return 'US';
  }
  return '';
}

/** Market country for a broker form/lead: explicit market_country, then region, then location text. */
export function marketCountryFromForm(form = {}) {
  const f = form || {};
  // "Other country": never guess CA / US from the city or region ("London", "Georgia", "Baja California").
  if (isOtherMarket(f.market_country)) return '';
  const explicit = normalizeMarketCountry(f.market_country || f.country);
  if (explicit) return explicit;
  const region = String(f.market_region || f.province_state || f.region || '').trim();
  if (region) {
    const code = region.toUpperCase();
    if (CA_PROVINCES[code] && !US_STATES[code]) return 'CA';
    if (US_STATES[code] && !CA_PROVINCES[code]) return 'US';
    const fromName = countryFromRegionText(region);
    if (fromName) return fromName;
  }
  return countryFromRegionText(`${f.address || ''} ${f.location || ''}`.trim());
}

/** 'CA' | 'US' | 'other' | '' for storing and prompting: "Other country" is kept instead of dropped. */
export function marketChoiceFromForm(form = {}) {
  return isOtherMarket(form?.market_country) ? OTHER_MARKET : marketCountryFromForm(form);
}

/** Every market stores and shows amounts in USD. */
export const MARKET_CURRENCY = 'USD';

export function marketCurrency() {
  return MARKET_CURRENCY;
}

export function marketRegionLabel(country) {
  return MARKET_COUNTRIES[country]?.regionLabel || 'Province / state';
}

export function marketRegionName(region, country) {
  const code = normalizeMarketRegion(region, country);
  if (!code) return String(region || '').trim();
  return (country === 'US' ? US_STATES[code] : country === 'CA' ? CA_PROVINCES[code] : CA_PROVINCES[code] || US_STATES[code]) || code;
}

/** Country-neutral labels for "Other country" (only the options offered in both Canada and the U.S.). */
const OTHER_FINANCING_LABELS = Object.freeze({
  conventional_rental: 'Investment-property mortgage (bank lender)',
  commercial_mortgage: 'Commercial mortgage (5+ units or commercial)',
  refinance_equity: 'Refinance or equity release',
  cash_purchase: 'Cash purchase (no financing)',
  not_sure: 'Not sure yet',
});
const OTHER_BORROWER_ENTITY_LABELS = Object.freeze({ personally: 'Personally', company: 'Through a company', not_sure: 'Not sure yet' });

export function investorFinancingLabel(value, country = '') {
  const key = String(value || '').trim();
  const option = INVESTOR_FINANCING[key];
  if (!option) return '';
  if (isOtherMarket(country)) return OTHER_FINANCING_LABELS[key] || option.US || option.CA || '';
  return option[country] || option.US || option.CA || '';
}

export function investorFinancingOptions(country) {
  if (isOtherMarket(country)) {
    return Object.entries(OTHER_FINANCING_LABELS).map(([value, label]) => ({ value, label }));
  }
  return Object.entries(INVESTOR_FINANCING)
    .filter(([, option]) => !country || option.markets.includes(country))
    .map(([value, option]) => ({ value, label: option[country] || option.US || option.CA }));
}

export function borrowerEntityLabel(value, country = '') {
  const key = String(value || '').trim();
  const option = BORROWER_ENTITY[key];
  if (!option) return '';
  if (isOtherMarket(country)) return OTHER_BORROWER_ENTITY_LABELS[key] || option.US;
  return option[country] || option.US;
}

/** "Ontario, Canada" / "Texas, United States" for summaries (no currency: amounts are always USD). */
export function marketSummary(form = {}) {
  const country = marketCountryFromForm(form);
  if (!country) {
    // "Other country" (or unknown): the typed city and region, e.g. "Lahore, Punjab".
    const rawRegion = String(form?.market_region || '').trim().slice(0, 80);
    const countryName = isOtherMarket(form?.market_country) ? String(form?.market_country_name || '').trim().slice(0, 80) : '';
    const parts = [];
    for (const part of [marketCityName(form?.market_city, rawRegion), rawRegion, countryName]) {
      if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) parts.push(part);
    }
    return parts.join(', ');
  }
  const region = marketRegionName(form?.market_region, country);
  const meta = MARKET_COUNTRIES[country];
  const city = marketCityName(form?.market_city, region);
  return `${city ? `${city}, ` : ''}${region ? `${region}, ` : ''}${meta.label}`;
}

/** City picked in the intake form, unless it only repeats the province / state name. */
export function marketCityName(city, regionName = '') {
  const value = String(city || '').trim().slice(0, 120);
  if (!value) return '';
  return regionName && value.toLowerCase() === String(regionName).toLowerCase() ? '' : value;
}

/** Province / state code named in free text ("Toronto, Ontario", "Austin, TX"), for a known or unknown country. */
export function marketRegionFromText(text, country = '') {
  const value = String(text || '');
  if (!value.trim() || isOtherMarket(country)) return '';
  const lists = country === 'CA' ? [CA_PROVINCES] : country === 'US' ? [US_STATES] : [CA_PROVINCES, US_STATES];
  const lower = value.toLowerCase();
  for (const list of lists) {
    const hit = Object.entries(list).find(([, name]) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(lower));
    if (hit) return hit[0];
  }
  const code = value.match(/,\s*([A-Z]{2})\b/)?.[1] || '';
  if (code) {
    for (const list of lists) if (list[code]) return code;
  }
  return '';
}

/**
 * Read-time market for a stored lead (no migration): the saved market fields for the role,
 * else the country / province inferred from the stored address or location text.
 * @param {object} profile LeadProfile (lean or doc)
 * @param {'mortgage_broker'|'lawyer'} role
 */
export function marketFromLeadProfile(profile = {}, role = 'mortgage_broker') {
  const q = profile?.qualification?.[role] || {};
  const text = `${profile?.property?.address || ''} ${profile?.property?.location || ''}`.trim();
  if (isOtherMarket(q.market_country)) {
    return {
      market_country: OTHER_MARKET,
      market_region: String(q.market_region || '').trim(),
      market_city: String(q.market_city || '').trim(),
      market_country_name: String(q.market_country_name || '').trim(),
      market_inferred: false,
    };
  }
  const storedCountry = normalizeMarketCountry(q.market_country);
  const country = storedCountry || marketCountryFromForm({ market_region: q.market_region, address: text });
  const region = normalizeMarketRegion(q.market_region, country) || String(q.market_region || '').trim()
    || marketRegionFromText(text, country);
  return {
    market_country: country || '',
    market_region: region || '',
    market_city: String(q.market_city || '').trim(),
    market_inferred: Boolean(country && !storedCountry),
  };
}

export function isBrokerInvestorForm(form = {}) {
  const f = form || {};
  return String(f.client_type || '').toLowerCase() === 'investor'
    || String(f.purchase_purpose || '').toLowerCase() === 'investment';
}

/**
 * Country-specific English names for broker and lawyer documents (upload line, prompt, and matching).
 * Broker ids: notice_of_assessment, entity_documents, lease_agreements.
 * Lawyer ids: purchase_agreement, title_deed, mortgage_commitment, condo_status.
 */
export const MARKET_DOCUMENT_NAMES = Object.freeze({
  CA: Object.freeze({
    notice_of_assessment: 'most recent Notice of Assessment (NOA)',
    entity_documents: 'corporate documents (articles of incorporation)',
    lease_agreements: 'current lease agreement for your rental property',
    purchase_agreement: 'Agreement of Purchase and Sale',
    title_deed: 'title search or transfer deed',
    mortgage_commitment: 'mortgage commitment letter',
    condo_status: 'condo status certificate (estoppel certificate)',
    preapproval_letter: 'mortgage pre-approval letter from a Canadian lender',
  }),
  US: Object.freeze({
    notice_of_assessment: 'most recent W-2',
    entity_documents: 'LLC or corporation documents (operating agreement and articles)',
    lease_agreements: 'current lease agreement for your rental property',
    purchase_agreement: 'purchase agreement (purchase and sale contract)',
    title_deed: 'deed or title commitment',
    mortgage_commitment: 'loan commitment letter',
    condo_status: 'HOA or condo association documents (resale certificate)',
    preapproval_letter: 'mortgage pre-approval letter from a U.S. lender',
  }),
  // "Other country": country-neutral names (no NOA / T4 / W-2 / LLC).
  other: Object.freeze({
    notice_of_assessment: 'most recent tax return',
    entity_documents: 'company registration documents',
    lease_agreements: 'current lease agreement for your rental property',
    purchase_agreement: 'purchase agreement (sale contract)',
    title_deed: 'title deed or proof of ownership',
    mortgage_commitment: 'mortgage or loan approval letter',
    condo_status: 'building or owners\' association documents',
    preapproval_letter: 'mortgage pre-approval letter from your lender',
  }),
});

/** French / Spanish market names (same ids as English), so a translated upload line keeps NOA/T4 vs W-2/1099. */
export const MARKET_DOCUMENT_NAMES_BY_LANGUAGE = Object.freeze({
  english: MARKET_DOCUMENT_NAMES,
  french: Object.freeze({
    CA: Object.freeze({
      notice_of_assessment: 'avis de cotisation (ACD) et feuillets T4 (déclarations T1 générales si travailleur autonome)',
      entity_documents: 'documents de la société (statuts constitutifs)',
      lease_agreements: 'baux et comptes de taxes foncières de vos immeubles locatifs',
      purchase_agreement: 'promesse d\'achat ou convention d\'achat-vente',
      title_deed: 'recherche de titre ou acte de transfert',
      mortgage_commitment: 'lettre d\'engagement hypothécaire',
      condo_status: 'certificat d\'état de la copropriété (certificat de préclusion)',
    }),
    US: Object.freeze({
      notice_of_assessment: 'formulaires W-2, 1099 ou déclarations de revenus récentes',
      entity_documents: 'documents de la LLC ou de la société (operating agreement et statuts)',
      lease_agreements: 'baux ou état locatif (rent roll) de vos immeubles locatifs',
      purchase_agreement: 'contrat d\'achat-vente (purchase agreement)',
      title_deed: 'acte de propriété ou engagement de titre (title commitment)',
      mortgage_commitment: 'lettre d\'engagement de prêt',
      condo_status: 'documents de l\'association de copropriétaires (HOA)',
    }),
  }),
  spanish: Object.freeze({
    CA: Object.freeze({
      notice_of_assessment: 'aviso de evaluación (NOA) y formularios T4 (declaraciones T1 General si trabaja por cuenta propia)',
      entity_documents: 'documentos de la corporación (artículos de incorporación)',
      lease_agreements: 'contratos de arrendamiento y recibos del impuesto predial de sus propiedades de alquiler',
      purchase_agreement: 'acuerdo de compraventa (Agreement of Purchase and Sale)',
      title_deed: 'búsqueda de título o escritura de transferencia',
      mortgage_commitment: 'carta de compromiso hipotecario',
      condo_status: 'certificado de estado del condominio (estoppel certificate)',
    }),
    US: Object.freeze({
      notice_of_assessment: 'formularios W-2, 1099 o declaraciones de impuestos recientes',
      entity_documents: 'documentos de la LLC o corporación (acuerdo operativo y artículos)',
      lease_agreements: 'contratos de arrendamiento o rent roll de sus propiedades de alquiler',
      purchase_agreement: 'contrato de compraventa (purchase agreement)',
      title_deed: 'escritura o compromiso de título (title commitment)',
      mortgage_commitment: 'carta de compromiso del préstamo',
      condo_status: 'documentos de la asociación de propietarios (HOA)',
    }),
  }),
});

/** Market name for a document id; `language` 'english' | 'french' | 'spanish' (others → ''). */
export function marketDocumentName(id, country, language = 'english') {
  return MARKET_DOCUMENT_NAMES_BY_LANGUAGE[language]?.[country]?.[id] || '';
}

/**
 * Earlier combined names ("W-2s, 1099s, or recent tax returns"). The upload line now asks for one document,
 * but a model reply that still uses the older wording must keep matching the same request.
 */
const LEGACY_DOCUMENT_NAMES = Object.freeze({
  notice_of_assessment: [
    'Notice of Assessment (NOA) and T4 slips (T1 Generals if self-employed)',
    'W-2s, 1099s, or recent tax returns',
    'recent tax returns or income statements',
  ],
  lease_agreements: [
    'lease agreements and property tax bills for your rental properties',
    'lease agreements or rent roll for your rental properties',
    'lease agreements for your rental properties',
  ],
});

/** Every market name for a document id across languages (reply matching). */
export function allMarketDocumentNames(id) {
  return [
    ...Object.values(MARKET_DOCUMENT_NAMES_BY_LANGUAGE)
      .flatMap((byCountry) => Object.values(byCountry).map((names) => names[id])),
    ...(LEGACY_DOCUMENT_NAMES[id] || []),
  ].filter(Boolean);
}

const INVESTOR_ONLY_BROKER_DOCS = new Set(['lease_agreements', 'entity_documents']);

/**
 * Broker document order. Investors: capital and rental-income proof; U.S. DSCR skips personal income docs;
 * cash purchases skip income docs and pre-approval. Non-investors never get investor-only docs.
 */
export function brokerDocumentOrder(context = {}) {
  const text = `${context.intent || ''} ${context.text || ''} ${context.purchasePurpose || ''}`;
  const investor = String(context.clientType || '').toLowerCase() === 'investor'
    || String(context.purchasePurpose || '').toLowerCase() === 'investment';
  if (!investor) {
    let order;
    if (/\brenew/i.test(text)) order = ['mortgage_statement', 'photo_id', 'notice_of_assessment', 'pay_stubs', 'preapproval_letter', 'proof_of_funds'];
    else if (/\brefinanc/i.test(text)) order = ['mortgage_statement', 'pay_stubs', 'notice_of_assessment', 'photo_id', 'preapproval_letter', 'proof_of_funds'];
    else order = ['pay_stubs', 'notice_of_assessment', 'photo_id', 'preapproval_letter', 'proof_of_funds', 'mortgage_statement'];
    return { order, exclude: INVESTOR_ONLY_BROKER_DOCS };
  }
  const financing = String(context.financingType || '').trim();
  const company = String(context.borrowerEntity || '').trim() === 'company';
  const ownsOthers = String(context.ownsInvestments || '').trim().toLowerCase() === 'yes';
  const entity = company ? ['entity_documents'] : [];
  const exclude = new Set(company ? [] : ['entity_documents']);
  if (financing === 'cash_purchase') {
    return { order: ['proof_of_funds', 'photo_id', ...entity], exclude: new Set([...exclude, 'pay_stubs', 'notice_of_assessment', 'preapproval_letter']) };
  }
  if (financing === 'dscr') {
    return {
      order: ['lease_agreements', 'proof_of_funds', 'photo_id', ...entity, 'mortgage_statement'],
      exclude: new Set([...exclude, 'pay_stubs', 'notice_of_assessment']),
    };
  }
  if (financing === 'refinance_equity') {
    return { order: ['mortgage_statement', 'lease_agreements', 'notice_of_assessment', 'photo_id', ...entity, 'pay_stubs'], exclude };
  }
  return {
    order: [
      'notice_of_assessment',
      'proof_of_funds',
      ...(ownsOthers ? ['lease_agreements', 'mortgage_statement'] : []),
      'photo_id',
      ...entity,
      'pay_stubs',
      'preapproval_letter',
      ...(ownsOthers ? [] : ['lease_agreements', 'mortgage_statement']),
    ],
    exclude,
  };
}

/** Prompt block for a broker investor: market terms, currency, docs, and what the intake already holds. */
export function brokerInvestorPromptBlock(form = {}, { fromChat = false } = {}) {
  if (!isBrokerInvestorForm(form)) return '';
  const country = marketChoiceFromForm(form);
  const known = [
    ['market', marketSummary(form)],
    ['investment type', BROKER_INVESTMENT_TYPES[form.investment_type] || ''],
    ['financing path', investorFinancingLabel(form.investment_financing, country)],
    ['borrowing as', borrowerEntityLabel(form.borrower_entity, country)],
    ['other investment properties', form.owns_investments ? String(form.owns_investments) : ''],
    ['down payment / capital', INVESTOR_DOWN_PAYMENT[form.down_payment_readiness] || ''],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const lines = ['INVESTOR FINANCING (this visitor is financing an investment property):'];
  if (known.length) lines.push(`- Already ${fromChat ? 'said in this chat' : 'on the intake form'}: ${known.join('; ')}. Do not ask these again.`);
  if (country === 'CA') {
    lines.push('- Market: Canada. Quote amounts in USD ($) and say "province", never "state". Use Canadian lending terms: rental property mortgage, A lender vs B lender or private lender, rental income offset vs add-back (lender-specific), equity take-out or HELOC, GDS/TDS debt-service ratios, borrowing personally vs through a corporation or holding company, and credit bureau (Equifax/TransUnion) history.');
    lines.push('- Canadian income documents are the Notice of Assessment (NOA), T4 slips, or T1 Generals for self-employed income; rentals use lease agreements and property tax bills. Do not mention W-2s, 1099s, DSCR loans, or LLCs.');
  } else if (country === 'US') {
    lines.push('- Market: United States. Quote amounts in USD and say "state", never "province". Use U.S. lending terms: conventional investment-property loan, DSCR loan (qualifies on the property\'s rental income rather than personal income), hard money, fix-and-flip or bridge loans, portfolio loans, cash-out refinance or HELOC, LLC vesting, credit score, number of financed properties, and cash reserves.');
    lines.push('- U.S. income documents are W-2s, 1099s, or tax returns; rentals use lease agreements or a rent roll; LLC borrowers need entity documents. DSCR borrowers usually skip personal income documents. Do not mention NOA, T4, CMHC, B lenders, or provinces.');
  } else if (country === OTHER_MARKET) {
    const where = marketSummary(form);
    lines.push(`- Market: outside Canada and the U.S.${where ? ` (${where})` : ''}. Do not ask whether the property is in Canada or the U.S. Quote amounts in USD and use the visitor's own words for their region.`);
    lines.push('- Use country-neutral terms: investment-property mortgage, proof of income (recent tax returns or income statements), bank statements, proof of funds, and company documents when borrowing through a company. Do not mention NOA, T4, W-2s, 1099s, DSCR loans, LLCs, CMHC, B lenders, provinces, or states. Say local lending rules are confirmed in the consultation.');
  } else {
    lines.push('- The market (Canada or the U.S.) is not known yet. Ask once which country and province or state the property is in before naming loan programs or tax documents.');
  }
  lines.push('- Cover only what is still missing, one question at a time: purchase vs refinance, property type and unit count, strategy (long-term rental, short-term rental, flip, BRRRR), purchase price, down payment or capital, properties already owned, timeline, pre-approval, and whether they borrow personally or through a company.');
  lines.push('- Investment properties usually need a larger down payment than a home they live in. Do not state a minimum percentage, insurance rule, ratio, or rate; say the exact lender requirements are confirmed in the consultation.');
  if (String(form.investment_financing || '') === 'cash_purchase') {
    lines.push('- This visitor plans a cash purchase: do not push pre-approval. Focus on proof of funds and any later refinance or equity plan.');
  }
  return lines.join('\n');
}

/** Document-request context fields a broker intake form carries (spread into requestContext). */
export function brokerDocumentContextFromForm(form = {}) {
  const f = form || {};
  return {
    market: marketChoiceFromForm(f),
    purchasePurpose: String(f.purchase_purpose || '').trim().toLowerCase(),
    financingType: String(f.investment_financing || '').trim(),
    borrowerEntity: String(f.borrower_entity || '').trim(),
    ownsInvestments: String(f.owns_investments || '').trim().toLowerCase(),
  };
}

/**
 * Lawyer prompt block: country-appropriate legal vocabulary. No tax rates, fees, or amounts.
 * Uses the intake form's market, else the property address / location text.
 */
export function lawyerMarketPromptBlock(form = {}) {
  const f = form || {};
  const text = `${f.address || ''} ${f.location || ''}`.trim();
  const country = marketChoiceFromForm(f);
  const regionCode = normalizeMarketRegion(f.market_region, country) || marketRegionFromText(text, country);
  const region = regionCode ? marketRegionName(regionCode, country) : String(f.market_region || '').trim();
  const where = country === OTHER_MARKET
    ? marketSummary(f)
    : [marketCityName(f.market_city, region), region, MARKET_COUNTRIES[country]?.label].filter(Boolean).join(', ');
  const lines = [`LEGAL MARKET${where ? ` (${where})` : ''}:`];
  if (country === 'CA') {
    lines.push(regionCode === 'QC'
      ? '- Quebec: real estate closings are handled by a notary. Say "notary" for the closing professional, and "province", never "state".'
      : '- Canada: say "province" or "territory", never "state". The closing is handled by a real estate lawyer (in Quebec, by a notary).');
    lines.push('- Use Canadian closing terms: Agreement of Purchase and Sale, title search, title insurance, land transfer tax (and any municipal land transfer tax), the statement of adjustments, and the condo status or estoppel certificate.');
    lines.push('- Do not mention closing attorneys, title or escrow companies, or a Closing Disclosure.');
  } else if (country === 'US') {
    lines.push('- United States: say "state", never "province". Depending on the state, the closing is handled by a closing attorney or a title / escrow company.');
    lines.push('- Use U.S. closing terms: purchase agreement, title search and title commitment, owner\'s and lender\'s title insurance, escrow, the Closing Disclosure, deed recording, and any state or local transfer taxes.');
    lines.push('- Do not mention land transfer tax, an Agreement of Purchase and Sale, status certificates, or notaries handling the closing.');
  } else if (country === OTHER_MARKET) {
    lines.push('- Outside Canada and the U.S.: do not ask whether the property is in Canada or the U.S., and do not say "province" or "state" unless the visitor does. Local rules decide who handles the closing.');
    lines.push('- Use country-neutral terms: purchase agreement, title or ownership check, transfer of title, registration, and any local transfer taxes. Do not mention land transfer tax, an Agreement of Purchase and Sale, status certificates, escrow companies, the Closing Disclosure, or LLCs.');
  } else {
    lines.push('- The country is not known yet. When it matters for the next answer, ask once whether the property is in Canada or the U.S. and which province or state.');
  }
  lines.push('- Do not state tax rates, fees, percentages, or amounts. Say the exact figures are confirmed in the consultation.');
  return lines.join('\n');
}

/**
 * Agent document-request context: the agent intake sends no market fields, so the market comes from the
 * picked area text ("Toronto, Ontario, Canada"); "other" when the form says so.
 */
export function agentDocumentContextFromForm(form = {}) {
  const f = form || {};
  const market = marketChoiceFromForm(f)
    || marketCountryFromForm({ address: `${f.location || f.buy_property_location || f.address || ''}` });
  return market ? { market } : {};
}

/** Lawyer document-request context from the intake form (country-specific document names, company buyers). */
export function lawyerDocumentContextFromForm(form = {}) {
  const f = form || {};
  const company = /company|corporat|llc|holding/i.test(String(f.via_company || ''));
  return {
    market: marketChoiceFromForm(f),
    ...(company ? { borrowerEntity: 'company' } : {}),
  };
}

const LAWYER_VIA_COMPANY_LABEL = { personally: 'personally', company: 'through a company', not_sure: 'not sure yet' };

/** Lawyer investor block: investment closing topics only. No tax, structuring, or legal advice. */
export function lawyerInvestorPromptBlock(form = {}, { fromChat = false } = {}) {
  const f = form || {};
  if (String(f.client_type || '').toLowerCase() !== 'investor') return '';
  const country = marketCountryFromForm(f);
  const via = String(f.via_company || '').trim();
  const viaLabel = LAWYER_VIA_COMPANY_LABEL[via] || via;
  const company = /company|corporat|llc|holding/i.test(via);
  const entity = country === 'US' ? 'LLC or corporation' : country === 'CA' ? 'corporation or holding company' : 'company';
  const lines = ['INVESTOR CLIENT (this visitor is buying, selling, or refinancing an investment property):'];
  if (viaLabel) lines.push(`- Already ${fromChat ? 'said in this chat' : 'on the intake form'}: purchasing ${viaLabel}. Do not ask this again.`);
  lines.push('- Never ask first-time-buyer questions or treat this as a home they will live in.');
  lines.push(`- Investment closing topics you can raise, one at a time and only when still missing: who takes title (personally or a ${entity}), existing tenants and leases to assume, deposits and rent adjustments on closing, and the lender's requirements for a rental property.`);
  if (company) lines.push(`- They are buying through a company: the ${entity} documents and who signs for it are needed for the closing. Do not advise on how to structure the company or its tax treatment.`);
  lines.push('- Do not give tax, structuring, or investment advice, and do not state tax rates, fees, or amounts. Say the details are reviewed in the consultation.');
  return lines.join('\n');
}

/**
 * Action-flow context (investor + market) for every role, from the intake form and the visitor client type.
 * Single source for prompts, post-booking checklists, and the lead summary.
 */
export function actionFlowContextFromForm(role, form = {}, clientType = '') {
  const f = form || {};
  const explicit = String(clientType || '').toLowerCase() === 'investor';
  if (role === 'mortgage_broker') {
    return { clientType: explicit || isBrokerInvestorForm(f) ? 'investor' : '', market: marketCountryFromForm(f) };
  }
  if (role === 'lawyer') {
    return {
      clientType: explicit || String(f.client_type || '').toLowerCase() === 'investor' ? 'investor' : '',
      market: marketCountryFromForm(f),
    };
  }
  const investor = explicit
    || String(f.client_type || '').toLowerCase() === 'investor'
    || String(f.motivation_reason || '').toLowerCase() === 'investment';
  return { clientType: investor ? 'investor' : '' };
}
