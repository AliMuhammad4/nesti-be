import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAssistant, settingForClientType, clientTypeForForm, questionLabel } from '../services/professionalAssistant/assistantSettings.js';
import { DOCUMENT_REQUESTS, QUALIFICATION_TEMPLATES } from '../services/professionalAssistant/catalog.js';
import { buildAgentSystemPrompt } from '../services/chat/prompts/agentPrompt.js';
import { buildPreviewLeadSummary, leadClientTypeExtras } from '../services/chat/handleChat/previewLeadSummary.js';
import {
  openQualificationQuestionIds,
  qualificationStillOpen,
  chatAnswersByQuestion,
  stripAnsweredIntakeAsks,
} from '../services/professionalAssistant/qualificationProgress.js';
import {
  availableOptionsOffer,
  investorOptionsFeedbackInstruction,
  investorOpeningQuestion,
  replyLanguage,
} from '../services/professionalAssistant/replyStyle.js';
import {
  assistantOfferedAvailableOptions,
  classifyAvailableOptionsFeedback,
  isAvailableOptionsConsentMessage,
  isAvailableOptionsDeclineMessage,
  shouldRefetchPropertyMatchesForMessage,
  historyOfferedAvailableOptions,
} from '../services/chat/utils/propertyMatchesRequestIntent.js';
import {
  appendCalendlyBookingLink,
  stripBookingLinks,
  offerConsultationAfterSkippedUpload,
  visitorSkipsDocumentRequest,
} from '../services/chat/utils/chatBookingReply.js';
import { applyDocumentAsk, nextDocumentRequest, followUpSkipIds, documentReviewReply } from '../services/chat/documents/chatDocumentService.js';
import { deriveQualificationFromText, scoreLead } from '../services/chat/scoring/agentScoring.js';
import { resolveInvestorClientType, buildLeadType, buildLeadClassification } from '../services/chat/scoring/common.js';
import { appendAssistantOverlay } from '../services/professionalAssistant/assistantPrompt.js';
import { agentFlow } from '../services/chat/agent/agentFlow.js';

const profile = { full_name: 'Sarah Johnson', location: 'Toronto', company_name: 'Nesti Realty' };

function investorSetting(overrides = {}) {
  return sanitizeAssistant({
    applied: true,
    personalities: ['consultative'],
    languages: ['english'],
    use_emojis: false,
    offer_property_matches: true,
    suggest_consultation: true,
    cta_label: 'Book an Investment Consultation',
    custom_guidance: 'Always frame advice around cash-flow and risk.',
    client_types: ['buyer', 'seller', 'investor'],
    next_actions: ['schedule', 'notify', 'save_lead'],
    document_requests: ['proof_of_funds', 'photo_id'],
    qualification_templates: {
      investor: {
        cta_label: 'Book an Investment Consultation',
        questions: [
          { id: 'investment_type', label: 'What type of investment are you interested in?', options: ['Rental property', 'Multi-unit'] },
          { id: 'location', label: 'Which markets are you considering?' },
          { id: 'budget', label: 'What is your investment budget?', options: ['Under $400k', '$400k–$700k', '$700k–$1M'] },
          { id: 'timeline', label: 'When are you planning to invest?' },
          { id: 'owns_investments', label: 'Do you already own investment properties?', options: ['Yes', 'No'] },
        ],
      },
    },
    ...overrides,
  }, 'agent');
}

test('investor customization: curated template reaches settingForClientType and prompt', () => {
  const base = investorSetting();
  const setting = settingForClientType(base, 'investor');
  assert.equal(setting.client_type, 'investor');
  assert.deepEqual(setting.qualification_questions, [
    'investment_type', 'location', 'budget', 'timeline', 'owns_investments',
  ]);
  assert.equal(setting.cta_label, 'Book an Investment Consultation');
  assert.equal(questionLabel(setting, 'owns_investments'), 'Do you already own investment properties?');

  const prompt = buildAgentSystemPrompt(profile, {
    assistantSetting: setting,
    clientType: 'investor',
    propertyMatchesEnabled: true,
    contactKnown: true,
  });
  assert.match(prompt, /investment_type|What type of investment/i);
  assert.match(prompt, /Book an Investment Consultation|investment/i);
  assert.match(prompt, /investor|investment/i);
  // Curated list must NOT force-inject the long default catalog extras.
  assert.doesNotMatch(prompt, /Ready to tour investment properties/i);
  assert.doesNotMatch(prompt, /If the right deal appeared tomorrow/i);
  assert.doesNotMatch(prompt, /Are you focused on rental income or appreciation/i);
});

test('investor customization: custom_guidance and tone reach overlay/prompt', () => {
  const setting = settingForClientType(investorSetting({
    personalities: ['persuasive'],
    custom_guidance: 'Push proof of funds early for investors.',
  }), 'investor');
  const overlay = appendAssistantOverlay('BASE PROMPT', setting, { clientType: 'investor' });
  assert.match(overlay, /Push proof of funds early for investors/);
  const prompt = buildAgentSystemPrompt(profile, { assistantSetting: setting, clientType: 'investor' });
  assert.match(prompt, /Push proof of funds early|persuasive|investment/i);
});

test('investor form client_type resolution and lead type/grade labels', () => {
  assert.equal(clientTypeForForm({ client_type: 'investor', intent: 'buy' }), 'investor');
  assert.equal(clientTypeForForm({ purchase_purpose: 'investment' }), 'investor');
  assert.equal(clientTypeForForm({ motivation_reason: 'investment', intent: 'buy' }), 'investor');
  assert.equal(resolveInvestorClientType({ motivationReason: 'investment' }), 'investor');
  assert.equal(resolveInvestorClientType({ investmentType: 'rental_property' }), 'investor');
  assert.equal(buildLeadType('hot', 'buy', 'investor'), 'hot_investor');
  assert.equal(buildLeadClassification('warm', 'buy', 'investor'), 'Warm Investor');
});

test('investor qualification progress respects curated questions and chat answers', () => {
  const setting = settingForClientType(investorSetting(), 'investor');
  const form = {
    client_type: 'investor',
    intent: 'buy',
    investment_type: 'rental_property',
    location: 'Hamilton',
    budget: '$700k',
  };
  const open = openQualificationQuestionIds(setting, form, []);
  assert.deepEqual(open, ['timeline', 'owns_investments']);
  assert.equal(qualificationStillOpen(setting, form, []), true);

  const history = [
    { role: 'assistant', content: 'Do you already own investment properties?' },
    { role: 'user', content: 'Yes' },
  ];
  const answers = chatAnswersByQuestion(setting, history, 'Yes');
  assert.equal(answers.owns_investments, 'Yes');

  const stripped = stripAnsweredIntakeAsks(
    'Nice. Which markets are you considering? What is your investment budget?',
    'agent',
    form,
    [],
  );
  assert.doesNotMatch(stripped, /markets are you considering/i);
  assert.doesNotMatch(stripped, /investment budget/i);
});

test('investor preview lead summary and extras after Q&A', () => {
  const setting = settingForClientType(investorSetting(), 'investor');
  const summary = buildPreviewLeadSummary({
    role: 'agent',
    setting,
    clientType: 'investor',
    form: {
      name: 'Alex Investor',
      email: 'alex@example.com',
      client_type: 'investor',
      intent: 'buy',
      budget: '$900k',
      investment_type: 'multi_unit',
      location: 'Hamilton',
    },
    history: [
      { role: 'assistant', content: 'Are you focused on rental income or appreciation?' },
    ],
    userMessage: 'Both cash flow and appreciation',
    details: {},
    contactInfo: { name: 'Alex Investor', email: 'alex@example.com' },
    leadGrade: 'warm',
    leadScore: 61,
    intent: 'buy',
  });
  assert.equal(summary.client_type, 'investor');
  assert.ok(summary.collected.some((c) => c.id === 'investment_type'));
  assert.ok(summary.remaining.map((r) => r.id).includes('timeline'));

  const extras = leadClientTypeExtras({
    role: 'agent',
    setting,
    clientType: 'investor',
    form: { budget: '$900k' },
    history: [{ role: 'assistant', content: 'What type of investment are you interested in?' }],
    userMessage: 'Rental property',
    leadGrade: 'warm',
    intent: 'buy',
  });
  assert.equal(extras.client_type, 'investor');
  assert.equal(extras.template_answers.investment_type, 'Rental property');
});

test('investor scoring awards investor bucket and persists investment fields', () => {
  const fq = {
    client_type: 'investor',
    investment_type: 'rental_property',
    investment_goal: 'rental_income',
    owns_investments: 'yes',
    down_payment_readiness: 'ready_now',
    mortgage_status: 'paying_cash',
    realtor_status: 'no_agent',
  };
  const scored = scoreLead({
    message: 'I want a rental duplex for cash flow ASAP',
    hasContact: true,
    contactInfo: { name: 'Alex', email: 'a@x.com' },
    interactionCount: 4,
    seedSignals: { timeline: '1-3 months', budget: '700000', location: 'Hamilton' },
    formQualification: fq,
  });
  assert.ok(scored.leadScore >= 40);
  assert.ok(['hot', 'warm', 'interested', 'cold'].includes(scored.leadGrade));
  assert.ok((scored.leadMeta?.lead_reasons || []).some((r) => /investor|investment/i.test(r)));
  assert.ok((scored.leadMeta?.sub_scores?.investorScore || 0) > 0);

  const derived = deriveQualificationFromText('Looking for rental property investment for cash flow');
  const update = agentFlow.getLeadProfileUpdate(
    { investment_type: 'rental_property', investment_goal: 'rental_income' },
    derived || {},
    { client_type: 'investor', investment_type: 'rental_property', investment_goal: 'rental_income', owns_investments: 'yes', down_payment: 'ready_now' },
  );
  assert.equal(update.investment_type, 'rental_property');
  assert.equal(update.investment_goal, 'rental_income');
  assert.equal(update.owns_investments, 'yes');
});

test('investor options offer, consent, decline, and calendly strip/append', () => {
  const setting = settingForClientType(investorSetting({ personalities: ['friendly'] }), 'investor');
  const offer = availableOptionsOffer(setting, true);
  assert.match(offer, /investment options/i);
  assert.equal(assistantOfferedAvailableOptions(offer), true);
  assert.equal(historyOfferedAvailableOptions([{ role: 'assistant', content: offer }]), true);

  assert.equal(
    shouldRefetchPropertyMatchesForMessage('yes', { afterOptionsOffer: true, previousAssistantReply: offer }),
    true,
  );
  assert.equal(
    isAvailableOptionsConsentMessage('yes', { afterOptionsOffer: true }),
    true,
  );
  assert.equal(isAvailableOptionsDeclineMessage('not interested in those options'), true);
  assert.equal(
    shouldRefetchPropertyMatchesForMessage('not interested in those options', {
      afterOptionsOffer: true,
      previousAssistantReply: offer,
    }),
    false,
  );

  const opening = investorOpeningQuestion(setting, '', '', 'Hamilton');
  assert.match(opening, /Hamilton/i);

  const withLink = appendCalendlyBookingLink('Happy to meet.', 'https://calendly.com/agent/intro', {
    allowSchedule: true,
    label: 'Book an Investment Consultation',
    force: true,
  });
  assert.match(withLink, /calendly\.com\/agent\/intro/);
  assert.equal(stripBookingLinks(withLink, 'https://calendly.com/agent/intro').includes('calendly.com'), false);

  const afterSkip = offerConsultationAfterSkippedUpload(
    'Please upload proof of funds?',
    'https://calendly.com/agent/intro',
    { allowSchedule: true, label: 'Book an Investment Consultation' },
  );
  assert.match(afterSkip, /calendly\.com/);
  assert.equal(visitorSkipsDocumentRequest("I don't have the proof of funds right now", 'proof of funds'), true);
});

test('investor match feedback is handed to the model with customization and qualification guidance', () => {
  const setting = settingForClientType(investorSetting(), 'investor');
  assert.equal(classifyAvailableOptionsFeedback('they look good'), 'positive');
  assert.equal(
    classifyAvailableOptionsFeedback('but i don6t want to go with those options you have shared'),
    'declined',
  );
  assert.equal(classifyAvailableOptionsFeedback('what is the expected return?'), null);

  const positive = investorOptionsFeedbackInstruction('positive', questionLabel(setting, 'budget'));
  assert.match(positive, /configured assistant voice, tone, formality, response length, language, and custom guidance/i);
  assert.match(positive, /What is your investment budget\?/i);
  assert.match(positive, /Do not request documents/i);
  assert.match(positive, /configured emoji rule/i);

  const declined = investorOptionsFeedbackInstruction('declined');
  assert.match(declined, /Acknowledge the decline without arguing/i);
  assert.match(declined, /market, budget, or property type/i);
  assert.match(declined, /Do not use canned wording/i);
});

test('investor document ask uses investor-relevant requests and skips after deferral', () => {
  const setting = settingForClientType(investorSetting(), 'investor');
  const next = nextDocumentRequest(setting, [], { clientType: 'investor', intent: 'buy', text: 'investor rental' });
  assert.ok(next);
  assert.ok(['proof_of_funds', 'photo_id', 'preapproval_letter'].includes(next.id));

  const asked = applyDocumentAsk(
    'Thanks for confirming your markets.',
    next,
    {
      userMessage: 'Hamilton duplexes',
      previousReply: 'Which markets are you considering?',
      setting,
      qualificationOpen: false,
    },
  );
  assert.ok(asked.request);
  assert.match(asked.reply, /proof of funds|photo id|pre-?approval/i);

  const skipped = followUpSkipIds(
    setting,
    [],
    { clientType: 'investor', intent: 'buy' },
    [
      { role: 'assistant', content: asked.reply },
      { role: 'user', content: "I don't have that document right now." },
    ],
    asked.reply,
  );
  assert.ok(skipped.includes(asked.request.id));
});

test('default investor catalog still larger than curated customization', () => {
  const defaults = QUALIFICATION_TEMPLATES.agent.investor.questions.map((q) => q.id);
  assert.ok(defaults.length >= 5);
  assert.ok(defaults.includes('investment_type'));
  assert.ok(defaults.includes('investment_goal'));
});


test('exact legacy investor catalog still upgrades to newer defaults', () => {
  const upgraded = sanitizeAssistant({
    applied: true,
    qualification_templates: {
      investor: {
        questions: [
          { id: 'investment_type' },
          { id: 'location' },
          { id: 'budget' },
          { id: 'investment_goal' },
          { id: 'timeline' },
        ],
      },
    },
  }, 'agent');
  const ids = settingForClientType(upgraded, 'investor').qualification_questions;
  assert.ok(ids.includes('property_type'));
  assert.ok(ids.includes('viewing_readiness'));
  assert.ok(ids.length > 5);
});

test('investor multi-file document review keeps investor doc order (no listing/MLS)', () => {
  const setting = settingForClientType(investorSetting(), 'investor');
  const ctx = {
    priorDocuments: [],
    clientType: 'investor',
    intent: 'buy',
    text: 'investor rental',
    previousReply: 'Please upload your proof of funds.',
  };
  const receipt = {
    _id: 'receipt', status: 'ready', text_ready: true, kind: 'pdf',
    original_filename: 'Receipt.pdf',
    summary: 'A payment receipt for a subscription.',
    extracted_text: 'Receipt total $20.',
    document_type: 'receipt',
  };
  const proof = {
    _id: 'proof', status: 'ready', text_ready: true, kind: 'pdf',
    original_filename: 'Proof.pdf',
    summary: 'Bank statement showing proof of funds available for a down payment.',
    extracted_text: 'Proof of funds. Available balance supports the purchase.',
    document_type: 'bank statement',
  };
  const reply = documentReviewReply([proof, receipt], setting, ctx);
  assert.match(reply, /proof of funds/i);
  assert.doesNotMatch(reply, /different file/i);
  assert.doesNotMatch(reply, /listing or MLS sheet/i);
  const wrongOnly = documentReviewReply([receipt], setting, ctx);
  assert.match(wrongOnly, /different file/i);
  assert.doesNotMatch(wrongOnly, /listing or MLS sheet/i);
});


test('investor catalog stays CA/US-aligned for questions and documents', () => {
  const investorQs = QUALIFICATION_TEMPLATES.agent.investor.questions;
  const byId = Object.fromEntries(investorQs.map((q) => [q.id, q]));
  assert.match(byId.location.label, /province or state/i);
  assert.match(byId.budget.label, /CAD|USD|market currency/i);
  assert.match(byId.preapproval.label, /pre-approved|cash|financ/i);
  assert.ok(byId.investment_type.options.some((o) => /flip/i.test(o)));
  assert.ok(byId.investment_type.options.some((o) => /commercial/i.test(o)));
  assert.ok(byId.owns_investments.options.some((o) => /company|llc/i.test(o)));

  const agentDocs = DOCUMENT_REQUESTS.agent.map(([id, label]) => ({ id, label }));
  const proof = agentDocs.find((d) => d.id === 'proof_of_funds');
  const pre = agentDocs.find((d) => d.id === 'preapproval_letter');
  assert.match(proof.label, /bank letter|statement/i);
  assert.match(pre.label, /U\.S\.|Canada/i);
  const condo = DOCUMENT_REQUESTS.lawyer.find(([id]) => id === 'condo_status');
  assert.match(condo[1], /HOA|status certificate/i);
});
