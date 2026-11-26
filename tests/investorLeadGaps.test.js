/**
 * Regression tests for the investor lead gaps (lookup / slot, public inquiries, insights, stats, matching).
 * Models are mocked with node:test `mock.method`; no DB connection.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LeadMatch from '../models/LeadMatch.js';
import LeadDocument from '../models/LeadDocument.js';
import LeadProfile from '../models/LeadProfile.js';
import { existingLeadTypePattern, syncLeadMatchAfterTurn } from '../services/chat/handleChat/chatLeadPipeline.js';
import { bumpLeadProfileStats, leadSlotFor } from '../services/chat/scoring/leadPersistence.js';
import { mortgageBrokerFlow } from '../services/chat/mortgageBroker/mortgageBrokerFlow.js';
import { lawyerFlow } from '../services/chat/lawyer/lawyerFlow.js';
import {
  normalizeLawyerInquiryBody,
  normalizeMortgageBrokerInquiryBody,
  resolveLawyerQualification,
  resolveMortgageBrokerQualification,
  validateMortgageBrokerInquiryInput,
} from '../services/client/clientProfessionalInquiryService.js';
import { buildQualificationData, resolveLeadType } from '../services/ai/leadInsights.js';

test('A: existing-lead pattern matches *_investor for client / buyer slots, not agent seller', () => {
  const client = existingLeadTypePattern('client');
  assert.ok(client.test('hot_client') && client.test('hot_investor') && !client.test('hot_buyer'));
  const buyer = existingLeadTypePattern('buyer');
  assert.ok(buyer.test('warm_buyer') && buyer.test('warm_investor') && !buyer.test('warm_seller'));
  const seller = existingLeadTypePattern('seller');
  assert.ok(seller.test('cold_seller') && !seller.test('cold_investor'));
  assert.ok(existingLeadTypePattern('seller', 'investor').test('cold_investor'));
});

test('A: investors share the client / buyer slot, so a type change cannot create a second row', () => {
  assert.equal(leadSlotFor('c1', 'hot_investor', 'mortgage_broker'), leadSlotFor('c1', 'hot_client', 'mortgage_broker'));
  assert.equal(leadSlotFor('c1', 'hot_investor', 'lawyer'), 'c1:client');
  assert.equal(leadSlotFor('c1', 'hot_investor', 'agent'), leadSlotFor('c1', 'warm_buyer', 'agent'));
  assert.equal(leadSlotFor('c1', 'hot_seller', 'agent'), 'c1:seller');
});

function fakeLead(leadType) {
  return {
    _id: 'lead-1',
    lead_type: leadType,
    lead_profile_id: null,
    compatibility_factors: { contact: { email: 'a@example.com' } },
    saved: 0,
    async save() { this.saved += 1; },
  };
}

function turnArgs(flow, overrides = {}) {
  return {
    flow,
    flowType: flow.flowRole,
    canCreateLeads: true,
    conversation: { _id: 'conv-1' },
    userId: 'user-1',
    professionalProfile: null,
    hasContact: true,
    contactInfo: { name: 'Pat', email: 'a@example.com' },
    conversationText: 'I want a rental property',
    trimmedMessage: 'Here is my lease',
    sessionId: 's1',
    embedToken: 't1',
    formContact: { purchase_purpose: 'investment', client_type: 'investor', email: 'a@example.com' },
    parsedAiDetails: {},
    finalScore: 85,
    persistedGrade: 'hot',
    leadMeta: {},
    aiIntent: 'unspecified',
    ...overrides,
  };
}

function mockModels(t, findOneResults) {
  const queries = [];
  let call = 0;
  t.mock.method(LeadMatch, 'findOne', (query) => {
    queries.push(query);
    const result = findOneResults[Math.min(call, findOneResults.length - 1)];
    call += 1;
    return { sort: async () => result };
  });
  t.mock.method(LeadMatch, 'findById', () => ({ lean: async () => null }));
  const links = [];
  t.mock.method(LeadDocument, 'updateMany', async (filter, update) => {
    links.push(update.$set.lead_match_id);
    return { modifiedCount: 1 };
  });
  return { queries, links };
}

for (const [name, flow] of [['broker', mortgageBrokerFlow], ['lawyer', lawyerFlow]]) {
  test(`A (${name}): a later turn updates the existing hot_investor lead and links documents`, async (t) => {
    const lead = fakeLead('hot_investor');
    const { queries, links } = mockModels(t, [lead]);
    const createNewLead = mock.fn(async () => { throw new Error('must not create a second lead'); });
    await syncLeadMatchAfterTurn(turnArgs({ ...flow, createNewLead }));
    assert.equal(createNewLead.mock.callCount(), 0);
    assert.ok(queries[0].lead_type.test('hot_investor'));
    assert.deepEqual(links, ['lead-1']);
    assert.equal(lead.saved, 1);
    assert.equal(lead.lead_type, 'hot_investor');
  });
}

test('A: mid-chat _client -> _investor updates the same lead (no duplicate)', async (t) => {
  const lead = fakeLead('warm_client');
  const { links } = mockModels(t, [lead]);
  const createNewLead = mock.fn(async () => { throw new Error('must not create'); });
  await syncLeadMatchAfterTurn(turnArgs({ ...mortgageBrokerFlow, createNewLead }));
  assert.equal(createNewLead.mock.callCount(), 0);
  assert.equal(lead.lead_type, 'hot_investor');
  assert.deepEqual(links, ['lead-1']);
  // Next turn: the row is now *_investor and is still found.
  assert.ok(existingLeadTypePattern(mortgageBrokerFlow.getIntentSuffix('unspecified')).test(lead.lead_type));
});

test('A: duplicate-slot error falls back to the existing investor row instead of dropping the turn', async (t) => {
  const lead = fakeLead('hot_investor');
  const { links } = mockModels(t, [null, lead]);
  const createNewLead = mock.fn(async () => { const e = new Error('dup'); e.code = 11000; throw e; });
  await syncLeadMatchAfterTurn(turnArgs({
    ...mortgageBrokerFlow,
    createNewLead,
    deriveQualificationFromText: () => ({}),
    getMergedAiDetails: () => ({}),
  }));
  assert.equal(createNewLead.mock.callCount(), 1);
  assert.deepEqual(links, ['lead-1']);
  assert.equal(lead.saved, 1);
});

test('B: public broker inquiry keeps investor + market fields (body first, then message text)', () => {
  const input = normalizeMortgageBrokerInquiryBody({
    message: 'Looking at a duplex',
    mortgage_timeline: '1_2_months',
    purchase_purpose: 'investment',
    budget: '400k_700k',
    investment_type: 'multi_unit',
    owns_investments: 'yes',
    investment_financing: 'conventional_rental',
    borrower_entity: 'company',
    market_country: 'CA',
    market_region: 'Ontario',
  });
  const q = resolveMortgageBrokerQualification(input, {});
  assert.equal(q.client_type, 'investor');
  assert.equal(q.investment_type, 'multi_unit');
  assert.equal(q.owns_investments, 'yes');
  assert.equal(q.investment_financing, 'conventional_rental');
  assert.equal(q.borrower_entity, 'company');
  assert.equal(q.market_country, 'CA');
  assert.equal(q.market_region, 'ON');
  assert.equal(q.budget, '400k_700k');

  const fromText = resolveMortgageBrokerQualification(normalizeMortgageBrokerInquiryBody({
    message: 'I want a DSCR loan through my LLC for a BRRRR in the USA',
    purchase_purpose: 'investment',
  }), {});
  assert.equal(fromText.investment_financing, 'dscr');
  assert.equal(fromText.borrower_entity, 'company');
  assert.equal(fromText.investment_type, 'brrrr');
  assert.equal(fromText.market_country, 'US');

  const homebuyer = resolveMortgageBrokerQualification(normalizeMortgageBrokerInquiryBody({
    message: 'First home', purchase_purpose: 'primary_residence', investment_type: 'multi_unit',
  }), {});
  assert.equal(homebuyer.client_type, '');
  assert.equal(homebuyer.investment_type, '');

  // Cash investors do not need a pre-approval; everyone else still does.
  const base = { message: 'x', mortgage_timeline: '1_2_months', purchase_purpose: 'investment' };
  assert.equal(validateMortgageBrokerInquiryInput({ ...base, investment_financing: 'cash_purchase' }), '');
  assert.match(validateMortgageBrokerInquiryInput(base), /Pre-approval/);
});

test('C: public lawyer inquiry keeps client_type / via_company (body first, then message text)', () => {
  const q = resolveLawyerQualification(normalizeLawyerInquiryBody({
    message: 'Closing question', transaction_type: 'home_purchase', closing_timeline: '30_60_days',
    legal_services_needed: 'full_closing', client_type: 'investor', via_company: 'company',
  }), {});
  assert.equal(q.client_type, 'investor');
  assert.equal(q.via_company, 'company');
  const fromText = resolveLawyerQualification(normalizeLawyerInquiryBody({
    message: 'Investment property purchase through my holding company', transaction_type: 'home_purchase',
  }), {});
  assert.equal(fromText.client_type, 'investor');
  assert.equal(fromText.via_company, 'company');
  assert.equal(normalizeLawyerInquiryBody({ client_type: 'buyer', via_company: 'bogus' }).client_type, '');
  assert.equal(normalizeLawyerInquiryBody({ via_company: 'bogus' }).via_company, '');
  // Lead type uses the client type (source-level: no DB in this test).
  const src = readFileSync(new URL('../services/client/clientProfessionalInquiryService.js', import.meta.url), 'utf8');
  assert.match(src, /buildLawyerLeadType\(leadGrade, qualification\.client_type\)/);
});

test('D: insights carry lawyer via_company + broker investor fields and an investor lead type', () => {
  const broker = {
    client_type: 'investor',
    budget_profile: { currency: 'CAD' },
    qualification: { mortgage_broker: { purchase_purpose: 'investment', investment_financing: 'b_private_lender', borrower_entity: 'company', market_country: 'CA', market_region: 'ON', investment_type: 'multi_unit' } },
  };
  const bq = buildQualificationData(broker, 'mortgage_broker');
  assert.equal(bq.investment_financing, 'b_private_lender');
  assert.equal(bq.market_country, 'CA');
  // Amounts are USD on every market (an older 'CAD' row reads back as USD).
  assert.equal(bq.currency, 'USD');
  assert.equal(resolveLeadType(broker, { lead_type: 'hot_investor' }, null, 'mortgage_broker'), 'mortgage_investor');
  assert.equal(resolveLeadType({}, { lead_type: 'hot_client' }, null, 'mortgage_broker'), 'mortgage_client');

  const lawyer = { client_type: 'investor', qualification: { lawyer: { via_company: 'company', transaction_type: 'home_purchase', legal_services_needed: 'full_closing' } } };
  assert.equal(buildQualificationData(lawyer, 'lawyer').via_company, 'company');
  assert.equal(resolveLeadType(lawyer, { lead_type: 'hot_investor' }, null, 'lawyer'), 'investment_home_purchase_closing');
  assert.equal(resolveLeadType({ qualification: lawyer.qualification }, { lead_type: 'hot_client' }, null, 'lawyer'), 'home_purchase_closing');
});

test('D: profile stats count lawyer / broker investors as client matches; agent investors stay buy matches', async (t) => {
  const calls = [];
  t.mock.method(LeadProfile, 'findByIdAndUpdate', async (id, update) => { calls.push(update.$inc); });
  await bumpLeadProfileStats('p1', 'unspecified', 'hot_investor');
  await bumpLeadProfileStats('p1', 'unspecified', 'warm_client');
  await bumpLeadProfileStats('p1', 'buy', 'hot_investor');
  assert.equal(calls[0]['stats.client_matches'], 1);
  assert.equal(calls[1]['stats.client_matches'], 1);
  assert.equal(calls[2]['stats.client_matches'], undefined);
  assert.equal(calls[2]['stats.buy_matches'], 1);
});

test('Extra 2: seller-side buyer candidates include agent investor leads', () => {
  const src = readFileSync(new URL('../services/agent/propertyMatch/matchService.js', import.meta.url), 'utf8');
  assert.match(src, /lead_type: \{ \$regex: '_\(buyer\|client\|investor\)\$' \}/);
  assert.ok(new RegExp('_(buyer|client|investor)$').test('hot_investor'));
});
