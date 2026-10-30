import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreviewLeadSummary,
  leadClientTypeExtras,
  suggestedNextAction,
} from '../services/chat/handleChat/previewLeadSummary.js';
import { sanitizeAssistant, settingForClientType } from '../services/professionalAssistant/assistantSettings.js';
import { applyLeadClientTypeExtras, syncLeadMatchAfterTurn } from '../services/chat/handleChat/chatLeadPipeline.js';

const agentSetting = sanitizeAssistant({
  applied: true,
  qualification_templates: {
    investor: {
      cta_label: 'Book an Investment Consultation',
      questions: [
        { id: 'investment_type', label: 'What type of investment property are you considering?', options: ['Condo', 'Multi-family'] },
        { id: 'location', label: 'Which area are you targeting?' },
        { id: 'budget', label: 'What budget range are you working with?' },
        { id: 'timeline', label: 'When do you want to buy?' },
      ],
    },
  },
}, 'agent');

test('Test My AI builds a CRM-style summary from the form, chat answers, and template without saving anything', () => {
  const setting = settingForClientType(agentSetting, 'investor');
  const summary = buildPreviewLeadSummary({
    role: 'agent',
    setting,
    clientType: 'investor',
    form: { name: 'Alex Investor', email: 'alex@example.com', budget: '$900k', client_type: 'investor', intent: 'buy' },
    history: [
      { role: 'assistant', content: 'Welcome! What type of investment property are you considering?' },
      { role: 'user', content: 'A duplex or small multi-family building.' },
      { role: 'assistant', content: 'Which area are you targeting?' },
    ],
    userMessage: 'Hamilton, close to the GO station.',
    details: {},
    contactInfo: { name: 'Alex Investor', email: 'alex@example.com' },
    leadGrade: 'warm',
    leadScore: 61,
    intent: 'buy',
  });

  assert.equal(summary.test_mode, true);
  assert.equal(summary.client_type, 'investor');
  assert.equal(summary.lead_grade, 'warm');
  assert.equal(summary.lead_score, 61);
  assert.equal(summary.contact.name, 'Alex Investor');
  assert.equal(summary.contact.email, 'alex@example.com');
  assert.equal(summary.budget, '$900k');
  assert.equal(summary.location, 'Hamilton, close to the GO station.');
  assert.equal(summary.service_requirement, 'A duplex or small multi-family building.');
  assert.deepEqual(summary.collected.map((item) => item.id), ['investment_type', 'location', 'budget']);
  assert.deepEqual(summary.remaining.map((item) => item.id), ['timeline']);
  assert.equal(summary.remaining[0].label, 'When do you want to buy?');
  assert.equal(summary.suggested_next_action.action, 'continue_qualification');
  assert.match(summary.suggested_next_action.label, /1 remaining qualification question$/);
  assert.equal(summary.suggested_next_action.cta_label, 'Book an Investment Consultation');
});

test('once the template is answered the next action becomes the professional CTA', () => {
  const done = suggestedNextAction('agent', 'hot', 'buy', 'Book an Investment Consultation', 0);
  assert.equal(done.action, 'book_consultation');
  assert.equal(done.label, 'Book an Investment Consultation');
  assert.ok(done.goal.length > 0);

  const broker = suggestedNextAction('mortgage_broker', 'warm', 'buy', '', 0);
  assert.equal(broker.action, 'book_consultation');
  assert.ok(broker.label.length > 0);

  const lawyer = suggestedNextAction('lawyer', 'cold', 'buy', '', 2);
  assert.equal(lawyer.action, 'continue_qualification');
  assert.match(lawyer.label, /2 remaining qualification questions/);
});

test('lead extras carry the client type, next action, and chat answers for the live pipeline only', () => {
  const setting = settingForClientType(agentSetting, 'investor');
  const extras = leadClientTypeExtras({
    role: 'agent',
    setting,
    clientType: 'investor',
    form: { budget: '$900k' },
    history: [{ role: 'assistant', content: 'What type of investment property are you considering?' }],
    userMessage: 'Condo',
    leadGrade: 'warm',
    intent: 'buy',
  });
  assert.equal(extras.client_type, 'investor');
  assert.deepEqual(extras.template_answers, { investment_type: 'Condo' });
  assert.equal(extras.suggested_next_action.action, 'continue_qualification');
  assert.match(extras.suggested_next_action.label, /2 remaining/);

  assert.equal(leadClientTypeExtras({ role: 'agent', setting, clientType: '', form: {}, history: [], userMessage: '' }), null);
  assert.equal(leadClientTypeExtras({ role: 'agent', setting: { ...setting, applied: false }, clientType: 'investor', form: {}, history: [], userMessage: '' }), null);
});

test('preview turns never create leads, link documents, or notify the professional', async () => {
  const flow = {
    flowRole: 'agent',
    getIntentSuffix: () => 'buy',
    deriveQualificationFromText: () => { throw new Error('qualification should not be derived in preview'); },
    getMergedAiDetails: () => { throw new Error('details should not be merged in preview'); },
    createNewLead: async () => { throw new Error('createNewLead must not run in preview'); },
  };
  const result = await syncLeadMatchAfterTurn({
    flow,
    flowType: 'agent',
    canCreateLeads: false,
    clientTypeExtras: { client_type: 'investor', suggested_next_action: { action: 'book_consultation' } },
    conversation: { _id: 'conversation-id' },
    userId: 'user-id',
    professionalProfile: { _id: 'profile-id' },
    hasContact: true,
    contactInfo: { name: 'Alex', email: 'alex@example.com' },
    conversationText: 'hello',
    trimmedMessage: 'hello',
    sessionId: 'session',
    embedToken: 'token',
    formContact: { intent: 'buy', client_type: 'investor', name: 'Alex', email: 'alex@example.com' },
    parsedAiDetails: {},
    finalScore: 80,
    persistedGrade: 'hot',
    leadMeta: {},
    aiIntent: 'buy',
    existingLeadMatchPrefetched: null,
  });
  assert.equal(result, undefined);
});

test('lead extras are skipped when there is no lead profile or client type', async () => {
  assert.equal(await applyLeadClientTypeExtras(null, { client_type: 'buyer' }), undefined);
  assert.equal(await applyLeadClientTypeExtras({ lead_profile_id: 'x' }, { client_type: '' }), undefined);
});
