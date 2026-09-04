export const STOREFRONT_TEMPLATE_TIERS = {
  'agent-investor': {
    template_id: 'agent-investor',
    name: 'Investor Specialist',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    professional_type: 'agent',
  },
  'agent-classic': {
    template_id: 'agent-classic',
    name: 'Realtor Classic',
    tier: 'basic',
    amount: 2500,
    currency: 'usd',
    interval: 'month',
    professional_type: 'agent',
  },
  'agent-first-home': {
    template_id: 'agent-first-home',
    name: 'First Home Specialist',
    tier: 'standard',
    amount: 7500,
    currency: 'usd',
    interval: 'month',
    professional_type: 'agent',
  },
  'agent-community-expert': {
    template_id: 'agent-community-expert',
    name: 'Community Expert',
    tier: 'standard',
    amount: 7500,
    currency: 'usd',
    interval: 'month',
    professional_type: 'agent',
  },
  'agent-luxury-advisor': {
    template_id: 'agent-luxury-advisor',
    name: 'Luxury Advisor',
    tier: 'premium',
    amount: 9900,
    currency: 'usd',
    interval: 'month',
    professional_type: 'agent',
  },
  'agent-seller-expert': {
    template_id: 'agent-seller-expert',
    name: 'Seller Expert',
    tier: 'premium',
    amount: 9900,
    currency: 'usd',
    interval: 'month',
    professional_type: 'agent',
  },
  'mortgage_broker-classic': {
    template_id: 'mortgage_broker-classic',
    name: 'Mortgage Lead Storefront',
    // Feature set matches Standard; keep unlocked while broker catalog pricing rolls out.
    tier: 'standard',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-first-home': {
    template_id: 'mortgage_broker-first-home',
    name: 'First Home Financing',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-wealth': {
    template_id: 'mortgage_broker-wealth',
    name: 'Wealth Financing',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-renewal': {
    template_id: 'mortgage_broker-renewal',
    name: 'Renewal and Refinance',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-commercial': {
    template_id: 'mortgage_broker-commercial',
    name: 'Commercial Financing',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    professional_type: 'mortgage_broker',
  },
  'lawyer-newcomer': {
    template_id: 'lawyer-newcomer',
    name: 'Newcomer Counsel',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    interval: 'month',
    professional_type: 'lawyer',
  },
  'lawyer-investor': {
    template_id: 'lawyer-investor',
    name: 'Investor Counsel',
    tier: 'basic',
    amount: 2500,
    currency: 'usd',
    interval: 'month',
    professional_type: 'lawyer',
  },
  'lawyer-classic': {
    template_id: 'lawyer-classic',
    name: 'Real Estate Counsel',
    tier: 'standard',
    amount: 7500,
    currency: 'usd',
    interval: 'month',
    professional_type: 'lawyer',
  },
  'lawyer-first-home-closing': {
    template_id: 'lawyer-first-home-closing',
    name: 'First Home Closing',
    tier: 'premium',
    amount: 9900,
    currency: 'usd',
    interval: 'month',
    professional_type: 'lawyer',
  },
};

export const FREE_TEMPLATE_IDS = new Set(
  Object.values(STOREFRONT_TEMPLATE_TIERS)
    .filter((template) => template.amount <= 0)
    .map((template) => template.template_id),
);

export function normalizeTemplateId(templateId) {
  return String(templateId || '').trim().toLowerCase();
}

export function getStorefrontTemplateTier(templateId) {
  return STOREFRONT_TEMPLATE_TIERS[normalizeTemplateId(templateId)] || null;
}

export function listStorefrontTemplateTiers() {
  return Object.values(STOREFRONT_TEMPLATE_TIERS);
}

export function isStorefrontTemplateFree(templateId) {
  return FREE_TEMPLATE_IDS.has(normalizeTemplateId(templateId));
}

export function storefrontTemplateSupportsProfile(template, profile) {
  return Boolean(
    template
    && profile
    && String(template.professional_type || '') === String(profile.professional_type || ''),
  );
}

export function displayAmountForTemplate(template) {
  if (!template || template.amount <= 0) return 'Free';
  return `$${Math.round(template.amount / 100)}/mo`;
}

export function lockedTemplateMessage(template) {
  return `${template.name} is a ${template.tier} template. Subscribe for ${template.amount / 100} USD/month before publishing.`;
}
