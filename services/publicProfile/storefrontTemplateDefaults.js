import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

const DEFAULT_STOREFRONT_TEMPLATE_IDS = Object.freeze({
  [PROFESSIONAL_TYPE.AGENT]: 'agent-investor',
  [PROFESSIONAL_TYPE.MORTGAGE_BROKER]: 'mortgage_broker-classic',
  [PROFESSIONAL_TYPE.LAWYER]: 'lawyer-newcomer',
});

export function defaultStorefrontTemplateIdForRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return DEFAULT_STOREFRONT_TEMPLATE_IDS[normalizedRole]
    || DEFAULT_STOREFRONT_TEMPLATE_IDS[PROFESSIONAL_TYPE.AGENT];
}
