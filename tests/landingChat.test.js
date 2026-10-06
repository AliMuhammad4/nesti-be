import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLeadInquirySource, sourceFilter } from '../services/admin/adminLeadService.js';
import { guideForAudience, landingChatPlanCards, landingSettingsView, planFacts, settingsPayload } from '../services/chat/nestiLanding/landingChatConfig.js';
import { asksHowNestiIsDifferent, cleanLandingReply, landingRoleReply, nestiLandingFlow, replyWithoutVisitorName, scoreLandingLead, shortenLandingReply } from '../services/chat/nestiLanding/nestiLandingFlow.js';
import { agreesToWalkthrough, askedForWalkthrough, detectPain, mentionsPricing, roleFallbackQuestion } from '../services/chat/nestiLanding/landingPainPoints.js';
import { emptyChatState, nextChatState } from '../services/chat/nestiLanding/landingChatState.js';
import { adminHasPermission, ADMIN_PERMISSION } from '../constants/adminPermissions.js';

test('landing settings keep empty guides on the built-in copy', () => {
  const view = landingSettingsView(null, null);
  assert.equal(view.enabled, true);
  assert.equal(view.display_name, 'Nesti');
  assert.equal(view.embed_ready, false);
  assert.match(guideForAudience(view, 'agent'), /inbox/);
  assert.match(guideForAudience({ agent_guide: 'Custom agent line' }, 'agent'), /Custom agent line/);
  assert.equal(settingsPayload({ enabled: false, display_name: 'Guide' }).enabled, false);
  assert.equal(planFacts().includes('$'), false);
  assert.equal(planFacts('agent').includes('9.99'), false);
  assert.match(planFacts('agent'), /150/);
  assert.match(planFacts('client'), /9\.99/);
});

test('landing score rises when contact and a signup ask are present', () => {
  const cold = scoreLandingLead({ message: 'hello', hasContact: false, contactInfo: {}, interactionCount: 1 });
  const hot = scoreLandingLead({
    message: 'I want to subscribe and start a trial',
    hasContact: true,
    contactInfo: { name: 'Sara', email: 'sara@example.com', phone: '4165550100' },
    interactionCount: 4,
  });
  assert.ok(hot.leadScore > cold.leadScore);
  assert.equal(hot.leadGrade === 'hot' || hot.leadGrade === 'warm', true);
  const prompt = nestiLandingFlow.buildSystemPrompt(null, { audience: 'lawyer', landingGuides: {}, contactKnown: true });
  assert.match(prompt, /You are Ravi/);
  assert.match(prompt, /lawyer/i);
  assert.match(prompt, /Never ask for them again/);
  assert.match(prompt, /\[\[plans\]\]/);
  assert.equal(prompt.includes('Say them in words'), false);
  const cards = landingChatPlanCards();
  assert.equal(cards.client.some((plan) => plan.price === '$9.99'), true);
  assert.equal(cards.professional.some((plan) => plan.price === '$150'), true);
  assert.equal(cards.client.some((plan) => String(plan.price).includes('150')), false);
  assert.equal(nestiLandingFlow.computeLeadType('warm'), 'warm_client');
  assert.equal(nestiLandingFlow.getIntentSuffix(), 'client');
});

test('a difference question is answered for the visitor role', () => {
  assert.equal(asksHowNestiIsDifferent('so how you are different from others'), true);
  const client = landingRoleReply('client');
  assert.match(client, /budget tools/i);
  assert.equal(/voice agent/i.test(client), false);
  assert.equal(/molestia/i.test(client), false);
  const agent = landingRoleReply('agent');
  assert.equal(/\bSara\b/.test(agent), false);
  assert.match(agent, /web page/i);
  assert.match(agent, /voice agent/i);
  assert.equal(/budget tools/i.test(agent), false);
  assert.equal(replyWithoutVisitorName('Hello Pariatur Itaque! Yes, you can have a web page.', 'Pariatur Itaque'), 'Yes, you can have a web page.');
  const broker = landingRoleReply('broker');
  assert.match(broker, /pre-approval/i);
  const lawyer = landingRoleReply('lawyer');
  assert.match(lawyer, /closing/i);
  assert.equal(/budget tools/i.test(lawyer), false);
});

test('pain points follow the visitor problem for each role', () => {
  assert.equal(detectPain('agent', 'I am struggling to follow up with leads').id, 'follow_up');
  assert.equal(detectPain('mortgage_broker', 'too many repetitive rate questions').id, 'rates');
  assert.equal(detectPain('lawyer', 'I keep getting repetitive closing inquiries').id, 'closing');
  assert.equal(detectPain('client', 'I am a first-time buyer and I feel overwhelmed').id, 'uncertainty');
  assert.equal(detectPain('client', 'I am an investor comparing professionals').id, 'investing');
  assert.equal(detectPain('client', 'I am hesitant to subscribe').id, 'uncertainty');
  assert.equal(mentionsPricing('how much is the plan'), true);
  assert.equal(Boolean(detectPain('agent', 'so how you are different from others')), false);
  assert.equal(asksHowNestiIsDifferent('I cannot follow up, so how are you different') && Boolean(detectPain('agent', 'I cannot follow up, so how are you different')), true);
  assert.equal(agreesToWalkthrough('yes') && askedForWalkthrough('Would you like me to walk you through Nesti?'), true);
  assert.equal(agreesToWalkthrough('yes') && askedForWalkthrough('What do you hope for?'), false);
});

test('chat state and the trimmer keep the problem that was already covered', () => {
  const once = nextChatState(emptyChatState(), { pain: { id: 'follow_up' }, feature: 'pipeline', question: 'Want help with follow-up?' });
  const twice = nextChatState(once, { feature: 'pipeline', question: 'Want help with follow-up?' });
  assert.deepEqual(twice.features_explained, ['pipeline']);
  assert.deepEqual(twice.questions_asked, ['Want help with follow-up?']);
  const prompt = nestiLandingFlow.buildSystemPrompt(null, {
    audience: 'agent',
    opening: false,
    featuresExplained: ['pipeline'],
    questionsAsked: ['Want help with follow-up?'],
    pain: { label: 'lead follow-up', feature: 'pipeline' },
  });
  assert.match(prompt, /Do not explain those again/);
  assert.match(prompt, /Do not ask those again/);
  assert.match(prompt, /lead follow-up/);
  const trimmed = shortenLandingReply('I hear that this is slipping. Nesti has many tools. The pipeline keeps each lead in view. Here is another sentence. What should we do next?', { feature: 'pipeline' });
  assert.match(trimmed, /pipeline/);
  assert.match(trimmed, /What should we do next\?/);
  assert.equal(trimmed.includes('another sentence'), false);
  const agentFallback = roleFallbackQuestion('agent');
  const lawyerFallback = roleFallbackQuestion('lawyer');
  assert.match(agentFallback, /follow up/i);
  assert.match(lawyerFallback, /closing/i);
  assert.equal(/molestia/i.test(agentFallback + lawyerFallback), false);
  const marked = cleanLandingReply('To create your chatbot, you can follow these steps: 1. **Log in to Your Nesti Account**: Visit the Nesti login page and sign in with your credentials. Would you like to proceed?');
  assert.equal(marked.includes('**'), false);
  assert.match(marked, /^- Log in to Your Nesti Account/m);
  assert.match(marked, /Would you like to proceed\?/);
});

test('landing chat leads are a distinct admin source', () => {
  assert.equal(deriveLeadInquirySource({ compatibility_factors: { source: 'landing_chat' } }), 'landing_chat');
  assert.equal(deriveLeadInquirySource({ compatibility_factors: { source: 'chatbot' } }), 'chatbot');
  assert.deepEqual(sourceFilter('landing_chat'), { 'compatibility_factors.source': 'landing_chat' });
  const chatbot = sourceFilter('chatbot');
  assert.equal(chatbot.$and[1]['compatibility_factors.source'].$ne, 'landing_chat');
});

test('landing lead alerts are limited to admins who can read leads', () => {
  assert.equal(adminHasPermission({ role: 'admin', admin_permissions: [ADMIN_PERMISSION.LEADS_READ] }, ADMIN_PERMISSION.LEADS_READ), true);
  assert.equal(adminHasPermission({ role: 'admin', admin_permissions: [] }, ADMIN_PERMISSION.LEADS_READ), false);
  assert.equal(adminHasPermission({ role: 'agent', admin_permissions: ['*'] }, ADMIN_PERMISSION.LEADS_READ), false);
});
