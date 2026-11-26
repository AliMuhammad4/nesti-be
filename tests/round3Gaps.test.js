/**
 * Round 3 regression tests: USD everywhere, lawyer Canada / U.S. market, inquiry email rows,
 * public-form investor intent, read-time market inference, stale cached lead type, neutral prompt
 * examples, FR/ES market document names, and the persisted intake summary card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MARKET_CURRENCY,
  lawyerDocumentContextFromForm,
  lawyerMarketPromptBlock,
  marketCurrency,
  marketDocumentName,
  marketFromLeadProfile,
  marketRegionFromText,
  marketSummary,
} from '../services/professionalAssistant/brokerInvestorMarket.js';
import { mapLeadProfileForApi } from '../services/lead/leadProfileFormat.js';
import {
  buildQualificationData,
  isCachedLeadTypeStale,
  resolveLeadType,
  withCurrentLeadType,
} from '../services/ai/leadInsights.js';
import {
  deriveLawyerQualificationFromText,
  resolveLawyerMarket,
} from '../services/chat/scoring/lawyerScoring.js';
import {
  buildLawyerLeadProfileUpdate,
  pickLawyerFormQualification,
} from '../services/chat/lawyer/lawyerQualificationHelpers.js';
import {
  normalizeLawyerInquiryBody,
  resolveLawyerQualification,
} from '../services/client/clientProfessionalInquiryService.js';
import { inquiryEmailDetailRows } from '../services/realtime/leadCreatedNotify.js';
import {
  buildLeadPayload,
  isPublicInvestorSubmission,
  resolveLeadTypeForSubmission,
  resolvePublicSubmissionIntent,
} from '../services/publicProfile/publicProfileLeadService.js';
import { submitPublicLeadSchema } from '../schemas/publicProfileSchemas.js';
import { chatBodySchema } from '../schemas/chatRouteSchemas.js';
import {
  leadProfilePreviewFromMeta,
  sanitizeLeadProfilePreview,
} from '../services/chat/handleChat/leadProfilePreview.js';
import { QUALIFICATION_TEMPLATES } from '../services/professionalAssistant/catalog.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// 1. Currency
test('1: currency is USD on every market and the market summary has no currency suffix', () => {
  assert.equal(MARKET_CURRENCY, 'USD');
  assert.equal(marketCurrency('CA'), 'USD');
  assert.equal(marketCurrency('US'), 'USD');
  assert.equal(marketCurrency(), 'USD');
  assert.equal(marketSummary({ market_country: 'CA', market_region: 'ON' }), 'Ontario, Canada');
  assert.doesNotMatch(marketSummary({ market_country: 'CA', market_region: 'ON' }), /CAD|\(/);
  // Old rows saved as CAD read back as USD.
  const view = mapLeadProfileForApi({ budget_profile: { currency: 'CAD' }, qualification: { mortgage_broker: {} } }, 'mortgage_broker');
  assert.equal(view.qualification.currency, 'USD');
  assert.equal(buildQualificationData({ budget_profile: { currency: 'CAD' }, qualification: { mortgage_broker: {} } }, 'mortgage_broker').currency, 'USD');
  // Canada block keeps Canadian lending terms but quotes USD.
  const caPrompt = lawyerMarketPromptBlock({ market_country: 'CA', market_region: 'ON' });
  assert.doesNotMatch(caPrompt, /\bCAD\b/);
});

test('1: no CAD in saving / display / KPI paths or question labels', () => {
  for (const path of [
    '../services/chat/scoring/leadPersistence.js',
    '../services/chat/scoring/mortgageBrokerScoring.js',
    '../services/client/clientProfessionalInquiryService.js',
    '../services/nurture/nurtureEmailOpenAi.js',
    '../services/calendly/postBooking/postBookingSectionBuilders.js',
    '../services/realtime/leadCreatedNotify.js',
  ]) {
    assert.doesNotMatch(src(path), /'CAD'|"CAD"/, path);
  }
  assert.match(src('../services/analytics/leadKpiService.js'), /const currency = 'USD'/);
  const labels = JSON.stringify(QUALIFICATION_TEMPLATES);
  assert.doesNotMatch(labels, /\bCAD\b/);
});

// 2. Lawyer Canada / U.S.
test('2: lawyer market is resolved from the form, the chat text, or the address', () => {
  assert.deepEqual(resolveLawyerMarket({ market_country: 'US', market_region: 'TX' }), { market_country: 'US', market_region: 'TX' });
  assert.equal(resolveLawyerMarket({ address: '12 King St, Toronto, ON' }).market_country, 'CA');
  assert.equal(resolveLawyerMarket({ address: '12 King St, Toronto, ON' }).market_region, 'ON');
  assert.equal(deriveLawyerQualificationFromText('closing on a condo in Canada').market_country, 'CA');
  assert.equal(deriveLawyerQualificationFromText('we are buying in the u.s. next month').market_country, 'US');
  assert.equal(deriveLawyerQualificationFromText('please use these documents').market_country, undefined);
  const picked = pickLawyerFormQualification({ market_country: 'CA', market_region: 'QC' });
  assert.equal(picked.market_country, 'CA');
  assert.equal(picked.market_region, 'QC');
  const update = buildLawyerLeadProfileUpdate({ market_country: 'US' }, {}, { market_country: 'CA', market_region: 'BC' });
  assert.equal(update.lawyer_market_country, 'CA');
  assert.equal(update.lawyer_market_region, 'BC');
});

test('2: lawyer inquiry saves market (explicit, else address) on the profile, match and notification', () => {
  const body = normalizeLawyerInquiryBody({ message: 'Need a closing lawyer', market_country: 'CA', market_region: 'ON' });
  assert.equal(body.market_country, 'CA');
  const q = resolveLawyerQualification(body, {});
  assert.equal(q.market_country, 'CA');
  assert.equal(q.market_region, 'ON');
  const fromAddress = resolveLawyerQualification(
    normalizeLawyerInquiryBody({ message: 'Closing help', property_address: '500 Main St, Austin, TX' }),
    {},
  );
  assert.equal(fromAddress.market_country, 'US');
  assert.equal(fromAddress.market_region, 'TX');
  const service = src('../services/client/clientProfessionalInquiryService.js');
  assert.match(service, /market_country: qualification\.market_country \|\| '',\s*market_region: qualification\.market_region \|\| '',\s*(market_city: qualification\.market_city \|\| '',\s*)?(market_country_name: qualification\.market_country_name \|\| '',\s*)?\},\s*\},/);
  assert.match(service, /qualification\.market_country \? \{ market_country: qualification\.market_country \}/);
});

test('2: lawyer prompt wording follows the country and never states tax numbers', () => {
  const ca = lawyerMarketPromptBlock({ market_country: 'CA', market_region: 'ON' });
  const qc = lawyerMarketPromptBlock({ market_country: 'CA', market_region: 'QC' });
  const us = lawyerMarketPromptBlock({ market_country: 'US', market_region: 'FL' });
  const unknown = lawyerMarketPromptBlock({});
  assert.match(ca, /province/i);
  assert.match(ca, /real estate lawyer/i);
  assert.match(ca, /land transfer tax/i);
  assert.match(ca, /title insurance/i);
  assert.match(qc, /notary/i);
  assert.match(us, /\bstate\b/i);
  assert.match(us, /closing attorney/i);
  assert.match(us, /title \/ escrow company/i);
  assert.match(us, /Closing Disclosure/);
  assert.match(unknown, /country/i);
  for (const block of [ca, qc, us, unknown]) {
    assert.doesNotMatch(block, /\d+(\.\d+)?\s*%/);
    assert.doesNotMatch(block, /\$\s*\d/);
  }
  assert.equal(lawyerDocumentContextFromForm({ market_country: 'US' }).market, 'US');
  assert.match(src('../services/chat/prompts/lawyerPromptBlocks.js'), /lawyerMarketPromptBlock\(/);
});

test('2: lawyer document names per country, lawyer market shown in lead details and insights', () => {
  assert.equal(marketDocumentName('purchase_agreement', 'CA'), 'Agreement of Purchase and Sale');
  assert.match(marketDocumentName('purchase_agreement', 'US'), /purchase agreement/);
  assert.match(marketDocumentName('condo_status', 'CA'), /status certificate/);
  assert.match(marketDocumentName('condo_status', 'US'), /HOA/);
  const lawyer = { qualification: { lawyer: { market_country: 'US', market_region: 'NY' } } };
  const view = mapLeadProfileForApi(lawyer, 'lawyer');
  assert.equal(view.qualification.market_country, 'US');
  assert.equal(view.qualification.market_region, 'NY');
  assert.equal(buildQualificationData(lawyer, 'lawyer').market_country, 'US');
});

// 3. Inquiry email rows
test('3: inquiry email rows show investor / entity / market only when they have a value', () => {
  const rows = inquiryEmailDetailRows({
    type: 'mortgage_broker_inquiry',
    client_name: 'Ana',
    purchase_purpose: 'investment',
    investment_type: 'multi_unit',
    owns_investments: 'yes',
    investment_financing: 'dscr',
    borrower_entity: 'company',
    market_country: 'US',
    market_region: 'TX',
    property_budget: '400k_700k',
  });
  const byLabel = Object.fromEntries(rows);
  assert.equal(byLabel['Client type'], 'Investor');
  assert.equal(byLabel.Market, 'Texas, United States');
  assert.ok(byLabel['Investment type']);
  assert.ok(byLabel['Financing path']);
  assert.ok(byLabel['Borrowing as']);
  assert.equal(byLabel['Owns other investment properties'], 'Yes');
  const lawyerRows = Object.fromEntries(inquiryEmailDetailRows({
    type: 'lawyer_inquiry', client_name: 'Bo', client_type: 'investor', via_company: 'company', market_country: 'CA', market_region: 'ON',
  }));
  assert.equal(lawyerRows['Purchasing as'], 'Through a company');
  assert.equal(lawyerRows.Market, 'Ontario, Canada');
  // Plain inquiry: only the name, no empty investor rows.
  assert.deepEqual(inquiryEmailDetailRows({ type: 'lawyer_inquiry', client_name: 'Cy' }), [['Client', 'Cy']]);
  // Other notification types never get rows.
  assert.deepEqual(inquiryEmailDetailRows({ type: 'property_inquiry', client_type: 'investor' }), []);
  const service = src('../services/client/clientProfessionalInquiryService.js');
  assert.equal((service.match(/sendNewLeadCreatedEmailIfEnabled\(professionalUserId/g) || []).length, 3);
});

// 4. Public profile form investor intent
test('4: public form accepts an investor intent and stores an interested_investor lead', () => {
  const { error, value } = submitPublicLeadSchema.validate(
    { full_name: 'Ivy', email: 'ivy@example.com', intent: 'invest', client_type: 'investor', market_country: 'US', via_company: 'company' },
    { stripUnknown: true },
  );
  assert.equal(error, undefined);
  assert.equal(value.intent, 'invest');
  assert.equal(value.client_type, 'investor');
  assert.equal(value.market_country, 'US');
  assert.ok(isPublicInvestorSubmission({ intent: 'invest' }));
  assert.ok(isPublicInvestorSubmission({ client_type: 'investor' }));
  assert.ok(isPublicInvestorSubmission({ purchase_purpose: 'investment' }));
  assert.ok(!isPublicInvestorSubmission({ intent: 'buy' }));
  assert.equal(resolvePublicSubmissionIntent('agent', { intent: 'invest' }), 'buy');
  assert.equal(resolvePublicSubmissionIntent('agent', { intent: 'sell' }), 'sell');
  assert.equal(resolvePublicSubmissionIntent('lawyer', { client_type: 'investor' }), 'unspecified');
  assert.equal(resolveLeadTypeForSubmission('agent', 'buy', true), 'interested_investor');
  assert.equal(resolveLeadTypeForSubmission('lawyer', 'unspecified', true), 'interested_investor');
  assert.equal(resolveLeadTypeForSubmission('agent', 'sell', true), 'interested_seller');
  assert.equal(resolveLeadTypeForSubmission('agent', 'buy', false), 'interested_buyer');
  assert.equal(resolveLeadTypeForSubmission('mortgage_broker', 'unspecified', false), 'interested_client');
  const form = { full_name: 'Ivy', via_company: 'company', first_time_buyer: 'yes', market_country: 'CA', market_region: 'ON' };
  const payload = buildLeadPayload({
    payload: form,
    intent: 'unspecified',
    message: '',
    propertyImages: [],
    investor: true,
    professionalType: 'lawyer',
  });
  assert.equal(payload.client_type, 'investor');
  assert.equal(payload.qualification.lawyer.via_company, 'company');
  assert.equal(payload.qualification.lawyer.first_time_buyer, '');
  assert.equal(payload.qualification.lawyer.market_country, 'CA');
  // Only the professional's own role section is filled.
  assert.deepEqual(payload.qualification.mortgage_broker, {});
  assert.deepEqual(payload.qualification.agent, {});
  const personal = buildLeadPayload({ payload: form, intent: 'unspecified', message: '', propertyImages: [], professionalType: 'lawyer' });
  assert.equal(personal.qualification.lawyer.via_company, '');
  assert.equal(personal.qualification.lawyer.first_time_buyer, 'yes');
  const broker = buildLeadPayload({ payload: form, intent: 'unspecified', message: '', propertyImages: [], investor: true, professionalType: 'mortgage_broker' });
  assert.equal(broker.qualification.mortgage_broker.purchase_purpose, 'investment');
  assert.deepEqual(broker.qualification.lawyer, {});
  const agent = buildLeadPayload({ payload: form, intent: 'buy', message: '', propertyImages: [], investor: true, professionalType: 'agent' });
  assert.equal(agent.qualification.agent.motivation_reason, 'investment');
  assert.deepEqual(agent.qualification.lawyer, {});
});

// 5. Old leads
test('5: old leads without a saved country infer the market from the stored address at read time', () => {
  const oldBroker = { property: { address: '88 Queen St W, Toronto, ON' }, qualification: { mortgage_broker: {} } };
  const view = mapLeadProfileForApi(oldBroker, 'mortgage_broker');
  assert.equal(view.qualification.market_country, 'CA');
  assert.equal(view.qualification.market_region, 'ON');
  const oldLawyer = { property: { location: 'Miami, FL' }, qualification: { lawyer: {} } };
  assert.equal(mapLeadProfileForApi(oldLawyer, 'lawyer').qualification.market_country, 'US');
  assert.equal(buildQualificationData(oldLawyer, 'lawyer').market_region, 'FL');
  assert.equal(marketFromLeadProfile(oldLawyer, 'lawyer').market_inferred, true);
  // Nothing to infer from: stays empty (no guessing).
  assert.equal(mapLeadProfileForApi({ property: { address: 'Somewhere' } }, 'lawyer').qualification.market_country, null);
  assert.equal(marketRegionFromText('Austin, TX', 'US'), 'TX');
});

// 6. Cached insights
test('6: a stale cached lead type is detected and patched without a new AI analysis', () => {
  const cached = { overview: { lead_type: 'buyer', budget_range: '$500K' }, conversion_guidance: { next_steps: ['call'] } };
  const investor = resolveLeadType({ client_type: 'investor' }, { lead_type: 'hot_investor' }, null, 'agent');
  assert.equal(investor, 'investor');
  assert.equal(isCachedLeadTypeStale(cached, investor), true);
  assert.equal(isCachedLeadTypeStale(cached, 'buyer'), false);
  const { payload, stale } = withCurrentLeadType(cached, investor);
  assert.equal(stale, true);
  assert.equal(payload.overview.lead_type, 'investor');
  assert.equal(payload.overview.budget_range, '$500K');
  assert.equal(cached.overview.lead_type, 'buyer', 'original cache object is not mutated');
  assert.equal(withCurrentLeadType(cached, 'buyer').payload, cached);
  assert.match(src('../services/ai/leadInsights.js'), /'ai_insights\.payload\.overview\.lead_type': currentLeadType/);
});

// 7. Prompt examples
test('7: prompt examples are neutral (no hardcoded Pakistani locations)', () => {
  for (const path of [
    '../services/professionalAssistant/assistantPrompt.js',
    '../services/chat/prompts/agentPrompt.js',
    '../services/chat/prompts/mortgageBrokerPromptBlocks.js',
    '../lawyer.html',
    '../mortgage-broker.html',
  ]) {
    assert.doesNotMatch(src(path), /Lahore|Karachi|Gulberg|\bDHA\b/, path);
  }
});

// 8. FR / ES document names
test('8: French and Spanish replies use the country-specific tax document names', () => {
  assert.match(marketDocumentName('notice_of_assessment', 'CA', 'french'), /T4/);
  assert.match(marketDocumentName('notice_of_assessment', 'US', 'french'), /W-2/);
  assert.match(marketDocumentName('notice_of_assessment', 'CA', 'spanish'), /T4/);
  assert.match(marketDocumentName('notice_of_assessment', 'US', 'spanish'), /W-2/);
  assert.equal(marketDocumentName('notice_of_assessment', 'CA', 'mandarin'), '');
  assert.match(src('../services/chat/documents/documentReviewReply.js'), /marketDocumentName\(id, requestContextValue\.market, language\) \|\| localizedDocumentName\(id, language\)/);
  const draft = src('../services/chat/handleChat/chatReplyDraft.js');
  assert.match(draft, /brokerDocumentContextFromForm\(storedForm\)/);
  assert.match(draft, /lawyerDocumentContextFromForm\(storedForm\)/);
});

// 10. Intake summary card
test('10: the intake summary card is sanitized, accepted by the chat API, and returned from history', () => {
  assert.equal(sanitizeLeadProfilePreview(null), null);
  assert.equal(sanitizeLeadProfilePreview({ headline: ' ', paragraphs: [] }), null);
  const card = sanitizeLeadProfilePreview({
    headline: 'Investment closing',
    paragraphs: ['**Name:** Ana', '', 42, 'x'.repeat(900)],
    summary: 'Investment closing lead',
    extra: 'dropped',
  });
  assert.equal(card.headline, 'Investment closing');
  assert.equal(card.paragraphs.length, 3);
  assert.equal(card.paragraphs[2].length, 600);
  assert.equal(card.summary, 'Investment closing lead');
  assert.equal(card.extra, undefined);
  assert.deepEqual(leadProfilePreviewFromMeta({ lead_profile_preview: { headline: 'A', paragraphs: ['b'] } }), { headline: 'A', paragraphs: ['b'] });
  const { error } = chatBodySchema.validate({ message: 'hi', embedToken: 't', leadProfilePreview: { headline: 'A', paragraphs: ['b'] } });
  assert.equal(error, undefined);
  assert.match(src('../services/chat/handleChat/chatTurnPrepare.js'), /lead_profile_preview: userLeadProfilePreview/);
  assert.match(src('../services/chat/handleChat/chatSessionQueries.js'), /lead_profile_preview: leadProfilePreviewFromMeta\(m\.meta\)/);
  assert.match(src('../services/lead/leadProfileHelpers.js'), /lead_profile_preview: leadProfilePreviewFromMeta\(m\.meta\)/);
});
