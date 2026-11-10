/**
 * Mortgage broker + investor flow audit (U.S. and Canada):
 * intake form -> stored qualification -> lead profile update paths / schema -> scoring -> prompt -> documents.
 * Pure helpers + an unsaved Mongoose document (no DB connection, no network).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import LeadProfile from '../models/LeadProfile.js';
import { pickStoredFormQualification, buildMortgageLeadProfileUpdate } from '../services/chat/mortgageBroker/mortgageBrokerQualificationHelpers.js';
import { LEAD_PROFILE_UPDATE_PATHS } from '../services/chat/handleChat/chatLeadPipeline.js';
import {
  mergeMortgageQualificationForScoring,
  scoreMortgageBrokerLead,
  deriveMortgageQualificationFromText,
} from '../services/chat/scoring/mortgageBrokerScoring.js';
import {
  brokerDocumentContextFromForm,
  brokerInvestorPromptBlock,
  investorFinancingOptions,
  marketCountryFromForm,
  marketCurrency,
  marketRegionLabel,
  marketSummary,
} from '../services/professionalAssistant/brokerInvestorMarket.js';
import { documentRequestIds, nextDocumentRequest } from '../services/chat/documents/documentRequestFlow.js';
import { applyDocumentAsk } from '../services/chat/documents/chatDocumentService.js';
import { DOCUMENT_REQUESTS } from '../services/professionalAssistant/catalog.js';
import { getMortgageBrokerActionFlow } from '../services/chat/config/mortgageBrokerActionFlow.js';

/** What frontend buildMortgageFormContact sends for an investor (rolePreflightCapture.js). */
const usInvestorForm = {
  intent: 'unspecified',
  professionalType: 'mortgage_broker',
  name: 'Mike Carter',
  email: 'mike@example.com',
  phone: '+15125550100',
  address: 'Austin',
  market_country: 'US',
  market_region: 'TX',
  mortgage_timeline: '1_2_months',
  pre_approval_status: 'need_now',
  credit_score_range: '700_749',
  employment_status: 'self_employed',
  household_income: '150k_200k',
  down_payment_readiness: '25_plus',
  budget: '400k_700k',
  property_budget: 'clearly_defined',
  purchase_purpose: 'investment',
  client_type: 'investor',
  investment_type: 'rental_property',
  owns_investments: 'yes',
  investment_financing: 'dscr',
  borrower_entity: 'company',
  urgency_signal: 'yes',
  preferred_contact_method: 'phone',
  best_time_to_contact: 'morning',
};

const caInvestorForm = {
  ...usInvestorForm,
  name: 'Priya Singh',
  address: 'Mississauga',
  market_country: 'CA',
  market_region: 'ON',
  investment_type: 'multi_unit',
  owns_investments: 'no',
  investment_financing: 'conventional_rental',
  borrower_entity: 'personally',
  down_payment_readiness: '20_24',
};

const brokerSetting = { role: 'mortgage_broker', document_requests: DOCUMENT_REQUESTS.mortgage_broker.map(([id]) => id) };

test('market: country drives region label; currency is USD on every market', () => {
  assert.equal(marketCountryFromForm(usInvestorForm), 'US');
  assert.equal(marketCountryFromForm(caInvestorForm), 'CA');
  assert.equal(marketCurrency('US'), 'USD');
  assert.equal(marketCurrency('CA'), 'USD');
  assert.equal(marketRegionLabel('US'), 'State');
  assert.match(marketRegionLabel('CA'), /Province/);
  assert.equal(marketSummary(caInvestorForm), 'Ontario, Canada');
  assert.equal(marketSummary(usInvestorForm), 'Texas, United States');
  // Inferred from address text when the country field is missing.
  assert.equal(marketCountryFromForm({ address: 'Toronto, ON' }), 'CA');
  assert.equal(marketCountryFromForm({ address: 'Austin, TX' }), 'US');
  assert.equal(marketCountryFromForm({ market_country: 'other', address: 'Somewhere' }), '');
  // U.S.-only and Canada-only financing paths.
  const us = investorFinancingOptions('US').map((o) => o.value);
  const ca = investorFinancingOptions('CA').map((o) => o.value);
  assert.ok(us.includes('dscr') && us.includes('hard_money_bridge') && !us.includes('b_private_lender'));
  assert.ok(ca.includes('b_private_lender') && !ca.includes('dscr'));
});

test('lead creation: form keys survive storage and map to qualification.mortgage_broker.* (no agent collision)', () => {
  for (const form of [usInvestorForm, caInvestorForm]) {
    const fq = pickStoredFormQualification(form);
    assert.equal(fq.client_type, 'investor');
    assert.equal(fq.investment_financing, form.investment_financing);
    assert.equal(fq.borrower_entity, form.borrower_entity);
    assert.equal(fq.market_country, form.market_country);
    assert.equal(fq.market_region, form.market_region);

    const update = buildMortgageLeadProfileUpdate({}, {}, form);
    assert.equal(update.mortgage_market_country, form.market_country);
    assert.equal(update.mortgage_market_region, form.market_region);
    assert.equal(update.mortgage_investment_financing, form.investment_financing);
    assert.equal(update.mortgage_borrower_entity, form.borrower_entity);
    for (const key of Object.keys(update).filter((k) => update[k] != null && update[k] !== '')) {
      const path = LEAD_PROFILE_UPDATE_PATHS[key];
      if (key.startsWith('mortgage_')) {
        assert.ok(path, `missing update path for ${key}`);
        assert.ok(!path.startsWith('qualification.agent.'), `${key} collides with agent qualification`);
      }
    }
  }
  assert.equal(LEAD_PROFILE_UPDATE_PATHS.mortgage_market_country, 'qualification.mortgage_broker.market_country');
  assert.equal(LEAD_PROFILE_UPDATE_PATHS.mortgage_investment_financing, 'qualification.mortgage_broker.investment_financing');
  // Broker keys stay in the broker block; the agent's own mortgage_status still points at the agent block.
  assert.equal(LEAD_PROFILE_UPDATE_PATHS.mortgage_status, 'qualification.agent.mortgage_status');
  assert.ok(Object.entries(LEAD_PROFILE_UPDATE_PATHS)
    .filter(([k]) => k.startsWith('mortgage_') && k !== 'mortgage_status')
    .every(([, path]) => path.startsWith('qualification.mortgage_broker.')));
});

test('lead schema keeps the new broker investor fields and currency (strict schema does not drop them)', () => {
  const doc = new LeadProfile({
    user_id: '507f1f77bcf86cd799439011',
    client_type: 'investor',
    qualification: {
      mortgage_broker: {
        purchase_purpose: 'investment',
        investment_type: 'multi_unit',
        investment_financing: 'conventional_rental',
        borrower_entity: 'company',
        market_country: 'CA',
        market_region: 'ON',
      },
    },
    budget_profile: { latest_budget_text: '400k_700k', currency: 'USD' },
  });
  const q = doc.qualification.mortgage_broker;
  assert.equal(q.investment_financing, 'conventional_rental');
  assert.equal(q.borrower_entity, 'company');
  assert.equal(q.market_country, 'CA');
  assert.equal(q.market_region, 'ON');
  // Amounts are USD on every market (Canadian leads included).
  assert.equal(doc.budget_profile.currency, 'USD');
  assert.equal(doc.client_type, 'investor');
});

test('scoring: investor down-payment bands, financing path, cash purchase, investor urgency wording', () => {
  const merged = mergeMortgageQualificationForScoring(pickStoredFormQualification(usInvestorForm), {});
  assert.equal(merged.investment_financing, 'dscr');
  assert.equal(merged.market_country, 'US');
  const scored = scoreMortgageBrokerLead({ message: '', hasContact: true, contactInfo: {}, interactionCount: 1, formQualification: merged });
  const reasons = scored.leadMeta.lead_reasons.join(' | ');
  assert.match(reasons, /Down payment: 25%\+/);
  assert.match(reasons, /Financing path: dscr/);
  assert.match(reasons, /investment deals immediately/);
  assert.doesNotMatch(reasons, /house hunting/);

  const cash = mergeMortgageQualificationForScoring(
    pickStoredFormQualification({ ...caInvestorForm, investment_financing: 'cash_purchase', down_payment_readiness: 'cash_purchase', pre_approval_status: '' }),
    {},
  );
  const cashReasons = scoreMortgageBrokerLead({ message: '', hasContact: true, contactInfo: {}, interactionCount: 1, formQualification: cash }).leadMeta.lead_reasons.join(' | ');
  assert.match(cashReasons, /Capital: cash purchase/);
  assert.match(cashReasons, /not needed \(cash purchase\)/);

  const derived = deriveMortgageQualificationFromText('I want a DSCR loan through my LLC for a BRRRR in the USA');
  assert.equal(derived.investment_financing, 'dscr');
  assert.equal(derived.borrower_entity, 'company');
  assert.equal(derived.investment_type, 'brrrr');
  assert.equal(derived.market_country, 'US');
  assert.equal(derived.client_type, 'investor');
});

test('prompt: investor block uses market terms and skips what the form answered', () => {
  const us = brokerInvestorPromptBlock(usInvestorForm);
  const ca = brokerInvestorPromptBlock(caInvestorForm);
  assert.match(us, /INVESTOR FINANCING/);
  assert.match(us, /DSCR/);
  assert.match(us, /USD/);
  assert.match(us, /LLC/);
  assert.match(ca, /USD/);
  assert.doesNotMatch(ca, /\bCAD\b/);
  assert.match(ca, /NOA|Notice of Assessment/);
  assert.match(ca, /B lender|private lender/i);
  assert.doesNotMatch(ca, /\bDSCR loan\b/);
  assert.equal(brokerInvestorPromptBlock({ purchase_purpose: 'primary_residence' }), '');
  assert.match(brokerInvestorPromptBlock({ purchase_purpose: 'investment' }), /country|province|state/i);
});

test('documents: investor + market ordering, names, and exclusions (U.S. vs Canada)', () => {
  // U.S. DSCR through an LLC: leases first, no pay stubs / tax slips, entity docs included.
  const usCtx = { clientType: 'investor', ...brokerDocumentContextFromForm(usInvestorForm) };
  const usIds = documentRequestIds(brokerSetting, usCtx);
  assert.equal(usIds[0], 'lease_agreements');
  assert.ok(usIds.includes('entity_documents'));
  assert.ok(!usIds.includes('pay_stubs'));
  assert.ok(!usIds.includes('notice_of_assessment'));
  const usNext = nextDocumentRequest(brokerSetting, [], usCtx);
  assert.equal(usNext.market, 'US');

  // Canada conventional rental, personally, first property: NOA first, no entity docs.
  const caCtx = { clientType: 'investor', ...brokerDocumentContextFromForm(caInvestorForm) };
  const caIds = documentRequestIds(brokerSetting, caCtx);
  assert.equal(caIds[0], 'notice_of_assessment');
  assert.ok(!caIds.includes('entity_documents'));
  const caNext = nextDocumentRequest(brokerSetting, [], caCtx);
  assert.equal(caNext.market, 'CA');
  const asked = applyDocumentAsk('Thanks, that helps. Here is what comes next.', caNext, {
    userMessage: 'I want to finance a rental property',
    setting: { ...brokerSetting, languages: ['english'] },
    qualificationOpen: false,
  });
  if (asked.request) assert.match(asked.reply, /Notice of Assessment|NOA/);

  // Cash investor: proof of funds, no income docs or pre-approval.
  const cashIds = documentRequestIds(brokerSetting, { ...caCtx, financingType: 'cash_purchase' });
  assert.equal(cashIds[0], 'proof_of_funds');
  assert.ok(!cashIds.includes('preapproval_letter') && !cashIds.includes('pay_stubs'));

  // Homebuyer (non-investor) flow is unchanged: no leases or entity docs.
  const buyerIds = documentRequestIds(brokerSetting, { clientType: 'buyer' });
  assert.equal(buyerIds[0], 'pay_stubs');
  assert.ok(!buyerIds.includes('lease_agreements') && !buyerIds.includes('entity_documents'));
});

test('action flow: investor checklist is market specific; homebuyer flow unchanged', () => {
  const us = getMortgageBrokerActionFlow('hot', { clientType: 'investor', market: 'US' });
  const ca = getMortgageBrokerActionFlow('hot', { clientType: 'investor', market: 'CA' });
  const buyer = getMortgageBrokerActionFlow('hot');
  assert.match(us.postBookingChatChecklist.join(' '), /W-2/);
  assert.doesNotMatch(us.postBookingChatChecklist.join(' '), /\bT4\b/);
  assert.match(ca.postBookingChatChecklist.join(' '), /T4|Notice/);
  assert.match(us.goal, /Investment/i);
  assert.deepEqual(buyer, getMortgageBrokerActionFlow('hot', {}));
  assert.ok(buyer.tierLabel && us.tierLabel === buyer.tierLabel);
});
