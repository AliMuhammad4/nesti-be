/**
 * Test My AI preview has no intake form. Infer the investor / market signals the live intake form would carry
 * from the selected test persona and the preview chat text, so the lawyer and broker investor and market prompt
 * blocks can be previewed. Never used for live chat.
 */
import { deriveLawyerQualificationFromText } from '../scoring/lawyerScoring.js';
import { marketCountryFromForm, marketRegionFromText } from '../../professionalAssistant/brokerInvestorMarket.js';

const BROKER_INVESTOR_TEXT = /\b(investment property|investor|rental property|rental income|dscr|brrrr|fix and flip|multi-?unit|duplex|triplex|fourplex)\b/i;

export function previewIntakeSignals(role, text = '', persona = '') {
  if (role !== 'lawyer' && role !== 'mortgage_broker') return null;
  const source = String(text || '');
  const derived = role === 'lawyer' ? deriveLawyerQualificationFromText(source) : {};
  const region = marketRegionFromText(source, derived.market_country || '');
  const country = derived.market_country || marketCountryFromForm({ market_region: region, address: source });
  const investor = persona === 'investor'
    || (persona !== 'seller' && (role === 'lawyer' ? derived.client_type === 'investor' : BROKER_INVESTOR_TEXT.test(source)));
  const signals = {
    ...(investor ? { client_type: 'investor' } : {}),
    ...(investor && role === 'mortgage_broker' ? { purchase_purpose: 'investment' } : {}),
    ...(role === 'lawyer' && derived.via_company ? { via_company: derived.via_company } : {}),
    ...(country ? { market_country: country } : {}),
    ...(region ? { market_region: region } : {}),
  };
  return Object.keys(signals).length ? signals : null;
}
