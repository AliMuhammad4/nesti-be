import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentSystemPrompt } from '../services/chat/prompts/agentPrompt.js';
import {
  openQualificationQuestionIds,
  stripAnsweredIntakeAsks,
  intakeValueFor,
} from '../services/professionalAssistant/qualificationProgress.js';
import { sanitizeAssistant, settingForClientType } from '../services/professionalAssistant/assistantSettings.js';

const profile = {
  full_name: 'Muhammad Ali',
  location: 'Lahore',
};

const buyerForm = {
  intent: 'buy',
  client_type: 'buyer',
  name: 'Ipsum rerum enim et',
  email: 'peruxa@mailinator.com',
  phone: '+15865262701',
  location: 'lahore',
  buy_property_location: 'johar town',
  budget: 'under 400k',
  property_type: 'Single Family',
  beds: '3',
  baths: '3',
  timeline: 'asap',
};

test('buyer intake: email/phone marks preferred_contact_method answered without re-ask', () => {
  assert.equal(
    Boolean(String(intakeValueFor('agent', 'preferred_contact_method', buyerForm) || '').trim()),
    true,
  );

  const setting = settingForClientType(sanitizeAssistant({
    applied: true,
    client_types: ['buyer', 'seller', 'investor'],
    qualification_questions: [
      'location',
      'budget',
      'timeline',
      'property_type',
      'preapproval',
      'preferred_contact_method',
    ],
  }, 'agent'), 'buyer');

  const open = openQualificationQuestionIds(setting, buyerForm);
  assert.equal(open.includes('preferred_contact_method'), false);

  const prompt = buildAgentSystemPrompt(profile, {
    assistantSetting: setting,
    intakeFormContact: buyerForm,
    contactKnown: true,
  });
  assert.match(prompt, /INTAKE FORM MEMORY|already captured these details/i);
  assert.match(prompt, /preferred contact method and best time/i);
  const questionsBlock = prompt.match(/LEAD QUALIFICATION QUESTIONS[\s\S]*?(?=\nINTAKE FORM MEMORY|\nThe intake form already|\nQUESTION FLOW)/)?.[0] || '';
  assert.doesNotMatch(questionsBlock, /preferred way to be contacted|preferred contact method for follow-ups/i);
  assert.match(questionsBlock, /pre-approved for a mortgage/i);

  const stripped = stripAnsweredIntakeAsks(
    'It is a pleasure to assist you. Could you please share your preferred contact method for follow-ups?',
    'agent',
    buyerForm,
  );
  assert.doesNotMatch(stripped, /preferred contact method/i);
});

test('buyer intake: filled preferred_contact_method still preferred over email inference', () => {
  const form = { ...buyerForm, preferred_contact_method: 'email', best_time_to_contact: 'evening' };
  assert.match(String(intakeValueFor('agent', 'preferred_contact_method', form)), /email/);
});
