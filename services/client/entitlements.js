export const CLIENT_FEATURE = {
  PROPERTY_MATCHING: 'property.matching',
  MORTGAGE_AFFORDABILITY: 'tools.mortgage_affordability',
  NESTPLAN_SAVINGS: 'nestplan.savings',
  SAVED_PROPERTIES: 'properties.saved',
  LISTING_ALERTS: 'properties.alerts',
  PROFESSIONAL_CONNECTIONS: 'professionals.connect',
  HOMEOWNERSHIP_DASHBOARD: 'dashboard.basic',
  ADVANCED_FINANCIAL_DASHBOARD: 'dashboard.advanced',
  ACTION_PLANS: 'plans.action',
  ADVANCED_MORTGAGE_SCENARIOS: 'tools.mortgage_scenarios',
  RENT_VS_BUY: 'tools.rent_vs_buy',
  PROPERTY_COMPARISONS: 'properties.compare',
  EQUITY_SELLING_PROCEEDS: 'equity.selling_proceeds',
  MARKET_MONITORING: 'market.monitoring',
  ADVANCED_SAVINGS: 'nestplan.advanced_projections',
  DEALSCORE: 'dealscore.analyzer',
  RENTAL_CASHFLOW: 'invest.cashflow',
  RETURNS_ANALYSIS: 'invest.returns',
  MULTI_PROPERTY: 'invest.multi_property',
  PORTFOLIO_EQUITY: 'invest.portfolio',
  REFINANCE_SCENARIOS: 'invest.refinance',
  INVESTMENT_WATCHLISTS: 'invest.watchlists',
  PORTFOLIO_REPORTING: 'invest.reporting',
};

export const CLIENT_FEATURE_LABELS = {
  [CLIENT_FEATURE.PROPERTY_MATCHING]: 'Property recommendations and matching',
  [CLIENT_FEATURE.MORTGAGE_AFFORDABILITY]: 'Budget and affordability tools',
  [CLIENT_FEATURE.NESTPLAN_SAVINGS]: 'Savings goal tracking',
  [CLIENT_FEATURE.SAVED_PROPERTIES]: 'Saved properties',
  [CLIENT_FEATURE.LISTING_ALERTS]: 'Listing alerts',
  [CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS]: 'Professional discovery and matching',
  [CLIENT_FEATURE.HOMEOWNERSHIP_DASHBOARD]: 'Personalized client dashboard',
  [CLIENT_FEATURE.ADVANCED_FINANCIAL_DASHBOARD]: 'Personalized AI real estate planning',
  [CLIENT_FEATURE.ACTION_PLANS]: 'Buyer, seller, and investor planning tools',
  [CLIENT_FEATURE.ADVANCED_MORTGAGE_SCENARIOS]: 'Budget and affordability tools',
  [CLIENT_FEATURE.RENT_VS_BUY]: 'Property comparison assistance',
  [CLIENT_FEATURE.PROPERTY_COMPARISONS]: 'Property comparison assistance',
  [CLIENT_FEATURE.EQUITY_SELLING_PROCEEDS]: 'Closing milestone tracking',
  [CLIENT_FEATURE.MARKET_MONITORING]: 'Personalized market monitoring',
  [CLIENT_FEATURE.ADVANCED_SAVINGS]: 'Savings goal tracking',
  [CLIENT_FEATURE.DEALSCORE]: 'Investment scenario calculators',
  [CLIENT_FEATURE.RENTAL_CASHFLOW]: 'Investment scenario calculators',
  [CLIENT_FEATURE.RETURNS_ANALYSIS]: 'Investment scenario calculators',
  [CLIENT_FEATURE.MULTI_PROPERTY]: 'Investment scenario calculators',
  [CLIENT_FEATURE.PORTFOLIO_EQUITY]: 'Investment scenario calculators',
  [CLIENT_FEATURE.REFINANCE_SCENARIOS]: 'Investment scenario calculators',
  [CLIENT_FEATURE.INVESTMENT_WATCHLISTS]: 'Investment opportunity monitoring',
  [CLIENT_FEATURE.PORTFOLIO_REPORTING]: 'Closing milestone tracking',
};

const ESSENTIAL_FEATURES = [
  CLIENT_FEATURE.PROPERTY_MATCHING,
  CLIENT_FEATURE.MORTGAGE_AFFORDABILITY,
  CLIENT_FEATURE.NESTPLAN_SAVINGS,
  CLIENT_FEATURE.SAVED_PROPERTIES,
  CLIENT_FEATURE.LISTING_ALERTS,
  CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS,
  CLIENT_FEATURE.HOMEOWNERSHIP_DASHBOARD,
];

const PLUS_ONLY_FEATURES = [
  CLIENT_FEATURE.ADVANCED_FINANCIAL_DASHBOARD,
  CLIENT_FEATURE.ACTION_PLANS,
  CLIENT_FEATURE.ADVANCED_MORTGAGE_SCENARIOS,
  CLIENT_FEATURE.RENT_VS_BUY,
  CLIENT_FEATURE.PROPERTY_COMPARISONS,
  CLIENT_FEATURE.EQUITY_SELLING_PROCEEDS,
  CLIENT_FEATURE.MARKET_MONITORING,
  CLIENT_FEATURE.ADVANCED_SAVINGS,
];

const PREMIUM_ONLY_FEATURES = [
  CLIENT_FEATURE.DEALSCORE,
  CLIENT_FEATURE.RENTAL_CASHFLOW,
  CLIENT_FEATURE.RETURNS_ANALYSIS,
  CLIENT_FEATURE.MULTI_PROPERTY,
  CLIENT_FEATURE.PORTFOLIO_EQUITY,
  CLIENT_FEATURE.REFINANCE_SCENARIOS,
  CLIENT_FEATURE.INVESTMENT_WATCHLISTS,
  CLIENT_FEATURE.PORTFOLIO_REPORTING,
];

export const CLIENT_FEATURES_BY_TIER = {
  essential: [...ESSENTIAL_FEATURES],
  plus: [...ESSENTIAL_FEATURES, ...PLUS_ONLY_FEATURES],
  premium: [...ESSENTIAL_FEATURES, ...PLUS_ONLY_FEATURES, ...PREMIUM_ONLY_FEATURES],
};

export const CLIENT_PLAN_ONLY_FEATURES = {
  essential: [...ESSENTIAL_FEATURES],
  plus: [...PLUS_ONLY_FEATURES],
  premium: [...PREMIUM_ONLY_FEATURES],
};

const CLIENT_DISPLAY_FEATURES = {
  essential: [
    'Real estate questions and guidance',
    'Personalized client dashboard',
    'Property goal tracking',
    'Professional discovery and matching',
  ],
  plus: [
    'Everything in Essential',
    'Personalized AI real estate planning',
    'Budget and affordability tools',
    'Savings goal tracking',
    'Buyer, seller, and investor planning tools',
  ],
  premium: [
    'Everything in Plus',
    'Property comparison assistance',
    'Investment scenario calculators',
    'Priority AI assistance',
    'Closing milestone tracking',
  ],
};

export function featureLabel(featureKey) {
  return CLIENT_FEATURE_LABELS[featureKey] || String(featureKey || '');
}

export function featureLabelsForKeys(keys = []) {
  return keys.map((key) => featureLabel(key)).filter(Boolean);
}

export function clientFeaturesForTier(tier) {
  const key = String(tier || '').trim().toLowerCase();
  return CLIENT_FEATURES_BY_TIER[key] ? [...CLIENT_FEATURES_BY_TIER[key]] : [];
}

export function clientHasFeature(tier, featureKey) {
  const feature = String(featureKey || '').trim();
  if (!feature) return false;
  return clientFeaturesForTier(tier).includes(feature);
}

export function displayFeaturesForTier(tier, { includeInherited = true } = {}) {
  const key = String(tier || '').trim().toLowerCase();
  const features = CLIENT_DISPLAY_FEATURES[key] || [];
  if (includeInherited) return [...features];
  if (key === 'plus' || key === 'premium') return features.slice(1);
  return [...features];
}
