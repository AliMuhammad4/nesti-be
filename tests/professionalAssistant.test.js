import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAssistantOverlay,
  appliedSettingForRole,
  assistantFaqsForRole,
  assistantAllowsLeadSaving,
  assistantSettingForPreview,
  assistantCatalog,
  draftFaqs,
  introductionLine,
  listingInsideServiceArea,
  finishLawyerReply,
  guardLawyerReply,
  lawyerReplyDrifted,
  buildPreviewChatPrompt,
  prefillAssistant,
  sanitizeAssistant,
  voiceTurnReminder,
} from '../services/professionalAssistant/professionalAssistantService.js';
import { withTurnReminder } from '../services/chat/handleChat/chatOpenAiTurn.js';
import { PERSONALITIES } from '../services/professionalAssistant/catalog.js';
import { buildAgentSystemPrompt } from '../services/chat/prompts/agentPrompt.js';
import { buildLawyerSystemPrompt } from '../services/chat/prompts/lawyerPrompt.js';
import { buildMortgageBrokerSystemPrompt } from '../services/chat/prompts/mortgageBrokerPrompt.js';
import { buildEmptyTurnFallbackReply, buildOutOfScopeReply } from '../services/chat/utils/chatScopeGuard.js';
import { professionalExpertiseLabels } from '../services/chat/utils/profileVisitorFacts.js';

const profile = { full_name: 'Sarah Johnson', company_name: 'RE/MAX', location: 'Toronto', languages_spoken: ['english', 'french'], country: 'Canada' };

test('professional chat uses profile experience and shows saved expertise', () => {
  const experienced = {
    ...profile,
    experience_level: 'senior',
    core_specialization_tags: ['waterfront homes'],
  };
  const setting = sanitizeAssistant({
    applied: true,
    services: ['luxury', 'relocation'],
    custom_expertise: ['Condo investors'],
    differentiators: ['experience', 'personal_service'],
  }, 'agent');
  const withYears = buildAgentSystemPrompt(experienced, { assistantSetting: setting, yearsExperience: 12 });
  assert.match(withYears, /Experience: 12 years/);
  assert.match(withYears, /Luxury real estate/);
  assert.match(withYears, /Relocation services/);
  assert.match(withYears, /Personalized one-on-one service/);
  assert.match(withYears, /Condo investors/);
  assert.doesNotMatch(withYears, /waterfront homes/);
  assert.match(withYears, /answer in the first person: "I have 12 years\."/);
  assert.match(withYears, /You are speaking as Sarah Johnson, in the first person/);
  assert.doesNotMatch(withYears, /speaking on Sarah Johnson's behalf/);
  assert.match(withYears, /say "I help with\.\.\." and list only the relevant services/);
  assert.match(withYears, /Do not say "Sarah Johnson has"/);
  assert.doesNotMatch(withYears, /Approved claims only: Years of professional experience/);

  const fromLevel = buildAgentSystemPrompt(experienced, {});
  assert.match(fromLevel, /Experience: Senior \(7-15 years\)/);
  assert.match(fromLevel, /waterfront homes/);

  const profileFallback = professionalExpertiseLabels(experienced, {
    applied: true,
    role: 'agent',
    services: [],
    differentiators: ['experience'],
    custom_expertise: [],
  });
  assert.deepEqual(profileFallback, ['waterfront homes']);

  const customizedExpertise = professionalExpertiseLabels(experienced, {
    applied: true,
    role: 'agent',
    services: ['luxury'],
    differentiators: [],
    custom_expertise: [],
  });
  assert.deepEqual(customizedExpertise, ['Luxury real estate']);

  const missing = buildLawyerSystemPrompt({ full_name: 'Ada Counsel' }, {});
  assert.match(missing, /Experience is not saved on the profile/);
  assert.match(missing, /Do not invent years of experience/);
});

test('an unsaved professional assistant does not change the role prompts', () => {
  const agent = buildAgentSystemPrompt(profile, {});
  const lawyer = buildLawyerSystemPrompt({ full_name: 'Ada Counsel', location: 'Ottawa' }, {});
  const broker = buildMortgageBrokerSystemPrompt({ full_name: 'Sam Broker', location: 'Calgary' }, {});
  for (const prompt of [agent, lawyer, broker]) {
    assert.doesNotMatch(prompt, /Professional-approved assistant settings/);
    assert.doesNotMatch(prompt, /LandingChatSetting/);
  }
  assert.match(agent, /ANY city or area/);
  assert.match(agent, /calm, kind, and emotionally aware/);
  assert.match(agent, /Are you currently working with a realtor/);
  assert.match(agent, /Prioritise the most impactful questions first/);
  assert.match(agent, /- \*\*Budget:\*\* \$400k/);
  assert.match(lawyer, /Ada Counsel/);
  assert.match(lawyer, /Calm, professional, reassuring/);
  assert.match(lawyer, /The lawyer intake form already collected/);
  assert.doesNotMatch(lawyer, /What stage are you in right now/);
  assert.match(lawyer, /share one Calendly link clearly/);
  assert.match(broker, /Sam Broker/);
  assert.match(broker, /calm, kind, and emotionally aware/);
  assert.match(broker, /The mortgage intake form already collected/);
  assert.doesNotMatch(broker, /When do you plan to apply for a mortgage/);
  assert.match(broker, /include one booking link in the same reply/);
});

test('applied settings stay on that role and leave the fallback prompt underneath', () => {
  const setting = sanitizeAssistant({
    applied: true,
    introduction_mode: 'custom',
    introduction_custom: 'A manually entered introduction',
    professional_title: 'Dr.',
    personalities: ['polished', 'friendly', 'luxury'],
    services: ['buying', 'commercial'],
    cities: ['Toronto'],
    differentiators: ['first_time'],
    unique_note: 'I specialize in helping first-time homebuyers.',
    faqs: [
      { question: 'Do you cover Toronto?', answer: 'Yes, Toronto is a served city.', approved: true, source: 'manual' },
      { question: 'Hidden?', answer: 'Not yet.', approved: false, source: 'generated' },
    ],
    qualification_questions: ['timeline', 'budget'],
    communication_style: 'quick',
    next_actions: ['collect_contact', 'save_lead'],
    languages: ['english'],
  }, 'agent');
  assert.equal('introduction_mode' in setting, false);
  assert.equal('introduction_custom' in setting, false);
  assert.equal('professional_title' in setting, false);
  assert.equal(introductionLine(setting, profile), 'Sarah Johnson');
  assert.deepEqual(setting.personalities, ['polished', 'friendly']);
  assert.equal(setting.services.includes('purchase_closing'), false);
  const prompt = buildAgentSystemPrompt(profile, {
    assistantSetting: { ...setting, introduction_line: introductionLine(setting, profile) },
  });
  assert.doesNotMatch(prompt, /ANY city or area/);
  assert.doesNotMatch(prompt, /calm, kind, and emotionally aware/);
  assert.match(prompt, /Professional and polished — Confident, articulate, and business-focused/);
  assert.match(prompt, /Quick and direct\. Short, concise responses/);
  assert.match(prompt, /Reply formality: professional\. Use clear professional language/);
  assert.match(prompt, /Do not flatten every reply into a generic warm, concise, professional voice/);
  assert.doesNotMatch(prompt, /When are you planning to buy or sell/);
  assert.doesNotMatch(prompt, /What is your purchase budget or expected selling price/);
  assert.doesNotMatch(prompt, /Have you been pre-approved for a mortgage/);
  assert.match(prompt, /The intake form already has intent, location, budget, timeline, property type, and mortgage status/);
  assert.match(prompt, /Are you currently working with a realtor/);
  assert.match(prompt, /one short sentence that points at the cards/);
  assert.doesNotMatch(prompt, /selected qualification/);
  assert.match(prompt, /An FAQ cannot replace that reply/);
  assert.match(prompt, /keep it short/);
  assert.match(prompt, /Do not repeat this recap on later turns/);
  assert.match(prompt, /Prioritise the most impactful questions first/);
  assert.match(prompt, /Bedrooms and bathrooms needed/);
  assert.match(prompt, /Ask one question, and keep it inside the saved reply length/);
  assert.match(prompt, /rewrite the wording in the selected voice/);
  assert.match(prompt, /Keep every fact, number, area, and condition from the saved answer/);
  assert.match(prompt, /rewritten in the selected voice, formality, and short reply length/);
  assert.doesNotMatch(prompt, /Blend this voice/);
  assert.doesNotMatch(prompt, /find a property/i);
  assert.doesNotMatch(prompt, /Scheduling is off/);
  assert.doesNotMatch(prompt, /Do not ask for or prompt the visitor to provide contact details/);
  assert.match(prompt, /Professional-approved assistant settings/);
  assert.match(prompt, /Sarah Johnson/);
  assert.match(prompt, /Speak as this professional in the first person/);
  assert.doesNotMatch(prompt, /speaking on Sarah Johnson's behalf/);
  assert.doesNotMatch(prompt, /show this expertise as a short bullet list/);
  assert.match(prompt, /Buying a home/);
  assert.match(prompt, /Do you cover Toronto/);
  assert.doesNotMatch(prompt, /Hidden/);
  assert.doesNotMatch(prompt, /Do not offer a booking link/);
  assert.match(prompt, /property matches appear only as chat cards/);
  assert.match(prompt, /For a seller, do not offer property match cards/);
  assert.doesNotMatch(prompt, /LandingChatSetting/);
});

test('saved lawyer and broker settings replace persona, questions, and booking', () => {
  const lawyerSetting = sanitizeAssistant({
    applied: true,
    personalities: ['polished'],
    communication_style: 'educational',
    qualification_questions: ['closing_date'],
    next_actions: ['collect_contact', 'save_lead'],
  }, 'lawyer');
  const lawyer = buildLawyerSystemPrompt({ full_name: 'Ada Counsel', location: 'Ottawa' }, { assistantSetting: lawyerSetting });
  assert.match(lawyer, /Professional and polished/);
  assert.match(lawyer, /Educational \(fact then question\)/);
  assert.match(lawyer, /The lawyer intake form already collected/);
  assert.doesNotMatch(lawyer, /What is your expected closing date/);
  assert.doesNotMatch(lawyer, /Calm, professional, reassuring/);
  assert.doesNotMatch(lawyer, /Are you working with a realtor/);
  assert.doesNotMatch(lawyer, /Scheduling is off/);
  assert.doesNotMatch(lawyer, /Hot —/);

  const brokerSetting = sanitizeAssistant({
    applied: true,
    personalities: ['caring'],
    qualification_questions: ['timeline'],
    next_actions: ['collect_contact'],
  }, 'mortgage_broker');
  const broker = buildMortgageBrokerSystemPrompt({ full_name: 'Sam Broker', location: 'Calgary' }, { assistantSetting: brokerSetting });
  assert.match(broker, /Caring and supportive/);
  assert.match(broker, /The mortgage intake form already collected/);
  assert.doesNotMatch(broker, /What is your preferred financing timeline/);
  assert.doesNotMatch(broker, /calm, kind, and emotionally aware/);
  assert.doesNotMatch(broker, /What is your approximate credit score/);
  assert.doesNotMatch(broker, /Scheduling is off/);
  assert.doesNotMatch(broker, /Do not ask for or prompt the visitor to provide contact details/);
});

test('agent chat does not repeat qualification answers already submitted on the intake form', () => {
  const setting = sanitizeAssistant({
    applied: true,
    qualification_questions: ['intent', 'location', 'budget', 'timeline', 'property_type', 'preapproval'],
  }, 'agent');
  const allAnswered = buildAgentSystemPrompt(profile, {
    assistantSetting: setting,
    intakeFormContact: {
      intent: 'buy',
      location: 'Toronto',
      buy_property_location: 'North York',
      budget: '$700k–$1M',
      timeline: '1-3 months',
      property_type: 'Condo',
      mortgage_status: 'fully_pre_approved',
    },
  });

  assert.match(allAnswered, /The submitted intake form already captured these details|INTAKE FORM MEMORY/);
  assert.doesNotMatch(allAnswered, /What is your preferred timeline/);
  assert.doesNotMatch(allAnswered, /Have you obtained mortgage pre-approval/);
  assert.doesNotMatch(allAnswered, /When are you planning to buy or sell/);
  assert.doesNotMatch(allAnswered, /Have you been pre-approved for a mortgage/);
  assert.doesNotMatch(allAnswered, /CUSTOMIZATION PRIORITY — qualification questions/);

  const partiallyAnswered = buildAgentSystemPrompt(profile, {
    assistantSetting: setting,
    intakeFormContact: {
      intent: 'buy',
      location: 'Toronto',
      budget: '$700k–$1M',
      timeline: '1-3 months',
      property_type: 'Condo',
      mortgage_status: '',
    },
  });
  assert.doesNotMatch(partiallyAnswered, /Have you been pre-approved for a mortgage/);
  assert.doesNotMatch(partiallyAnswered, /When are you planning to buy or sell/);
  assert.match(partiallyAnswered, /The intake form already has intent, location, budget, timeline, property type, and mortgage status/);

  const defaultPrompt = buildAgentSystemPrompt(profile, {
    intakeFormContact: {
      intent: 'buy',
      location: 'Toronto',
      budget: '$700k–$1M',
      timeline: '1-3 months',
      property_type: 'Condo',
      mortgage_status: 'fully_pre_approved',
      realtor_status: 'no_agent',
      motivation_reason: 'relocation',
      viewing_readiness: 'few_weeks',
      living_situation: 'renting',
      urgency_readiness: 'maybe',
      preferred_contact_method: 'email',
      best_time_to_contact: 'anytime',
    },
  });
  assert.match(defaultPrompt, /INTAKE FORM MEMORY \(authoritative\)/);
  assert.doesNotMatch(defaultPrompt, /What is your purchase budget or expected selling price/);
  assert.doesNotMatch(defaultPrompt, /Are you currently working with a realtor/);
});

test('each built-in chat tone changes the agent reply voice', () => {
  for (const [id, label, description] of PERSONALITIES) {
    const setting = sanitizeAssistant({
      applied: true,
      personalities: [id],
      communication_style: 'conversational',
      qualification_questions: ['timeline'],
    }, 'agent');
    const prompt = buildAgentSystemPrompt(profile, { assistantSetting: setting });
    assert.match(prompt, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(prompt, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(prompt, /calm, kind, and emotionally aware/);
  }
  assert.equal(PERSONALITIES.length, 6);
});

test('an empty spoken name and a mismatched role do not change the chat', () => {
  const unnamed = sanitizeAssistant({ applied: true, bot_name: '   ' }, 'agent');
  assert.equal(unnamed.bot_name, '');
  assert.doesNotMatch(appendAssistantOverlay('Role prompt', unnamed), /spoken assistant name/);
  assert.equal(appliedSettingForRole({ applied: true, role: 'agent' }, 'lawyer'), null);
  assert.equal(appliedSettingForRole({ applied: true, role: 'lawyer' }, 'lawyer')?.role, 'lawyer');
  assert.equal(appliedSettingForRole({ applied: false, role: 'agent' }, 'agent'), null);
});

test('prefill and FAQ drafts use the professional profile without applying themselves', () => {
  const draft = prefillAssistant('lawyer', { ...profile, jurisdiction: 'Ontario', website: 'https://example.com' });
  assert.equal(draft.applied, false);
  assert.deepEqual(draft.jurisdictions, ['Ontario']);
  assert.equal('website_import_url' in draft, false);
  const faqs = draftFaqs({ ...draft, role: 'lawyer', services: ['purchase_closing'] }, profile);
  assert.equal(faqs[0].approved, false);
  assert.match(faqs[0].question, /purchase closings/i);
  assert.equal(appendAssistantOverlay('Role prompt', draft), 'Role prompt');
});

test('service notes and custom guidance reach prompts while unused settings are discarded', () => {
  const setting = sanitizeAssistant({
    applied: true,
    services_pricing: 'Consultation fees are discussed before booking.',
    custom_guidance: 'Explain the closing process in plain language.',
    website_import_url: 'https://example.com',
    faq_upload_note: 'Uploaded notes',
    voice_accent: 'Canadian',
    transfer_calls: true,
  }, 'lawyer');
  const prompt = appendAssistantOverlay('Role prompt', setting);

  assert.match(prompt, /Approved service notes: Consultation fees are discussed before booking/);
  assert.match(prompt, /Professional instructions: Explain the closing process in plain language/);
  assert.equal('website_import_url' in setting, false);
  assert.equal('faq_upload_note' in setting, false);
  assert.equal('voice_accent' in setting, false);
  assert.equal('transfer_calls' in setting, false);
});

test('professional custom tones and expertise persist and reach the applied chat prompt', () => {
  const setting = sanitizeAssistant({
    applied: true,
    personalities: ['custom-buyer-guide', 'friendly'],
    formality: 'casual',
    custom_tones: [{
      id: 'custom-buyer-guide',
      name: 'First-time buyer guide',
      guidance: 'Explain each buying step clearly and without pressure.',
    }],
    custom_expertise: ['First-time condo buyers', 'Relocation to Toronto'],
  }, 'agent');
  assert.deepEqual(setting.personalities, ['custom-buyer-guide', 'friendly']);
  assert.deepEqual(setting.custom_expertise, ['First-time condo buyers', 'Relocation to Toronto']);

  const prompt = appendAssistantOverlay('Role prompt', setting);
  assert.match(prompt, /First-time buyer guide/);
  assert.match(prompt, /Explain each buying step clearly and without pressure/);
  assert.match(prompt, /Reply formality: casual/);
  assert.match(prompt, /First-time condo buyers; Relocation to Toronto/);

  const faq = draftFaqs({
    role: 'agent',
    services: [],
    custom_expertise: ['First-time condo buyers'],
    cities: ['Toronto'],
  }, profile)[0];
  assert.match(faq.question, /first-time condo buyers/i);
  assert.match(faq.answer, /Toronto/);
});

test('preview applies current unsaved settings without saving them', () => {
  const previewSetting = assistantSettingForPreview({
    applied: false,
    personalities: ['friendly'],
    custom_guidance: 'Use an upbeat, welcoming greeting.',
  }, 'agent');
  const prompt = buildAgentSystemPrompt(profile, {
    assistantSetting: previewSetting,
    previewConversation: true,
  });

  assert.equal(previewSetting.applied, true);
  assert.match(prompt, /Friendly and approachable/);
  assert.match(prompt, /Use an upbeat, welcoming greeting/);
  assert.match(prompt, /This preview has no intake form/);
  assert.match(prompt, /yes am looking for/);
  assert.match(prompt, /Friendly: easy, upbeat, texting rhythm/);
  assert.doesNotMatch(prompt, /Sample shape/);
  assert.match(prompt, /Rewrite every scheduling sentence/);
  assert.match(prompt, /Never copy wording from these instructions/);
  assert.match(prompt, /"How can I assist you"/);
  assert.match(prompt, /the reply must start with a greeting/);
  assert.match(prompt, /Friendly opening: a casual hello/);
  assert.match(prompt, /buying or selling/);
  assert.doesNotMatch(prompt, /Are you currently working with a realtor/);
  assert.match(prompt, /This preview has no intake list/);
  assert.doesNotMatch(prompt, /The intake form already has intent, location, budget/);
  assert.doesNotMatch(prompt, /The intake form already collects intent/);
  assert.doesNotMatch(prompt, /Preferred booking invite for consistency/);
});

test('preview chat prompt stays short and skips the scoring block', () => {
  const setting = sanitizeAssistant({
    applied: true,
    role: 'agent',
    personalities: ['caring', 'persuasive'],
    communication_style: 'quick',
    formality: 'casual',
  }, 'agent');
  const full = buildAgentSystemPrompt(profile, { assistantSetting: setting, previewConversation: true });
  const preview = buildPreviewChatPrompt('agent', profile, { assistantSetting: setting, yearsExperience: 12 });

  assert.ok(preview.length < full.length / 2);
  assert.match(preview, /Speak in the first person/);
  assert.match(preview, /Caring: patient and reassuring/);
  assert.match(preview, /I have 12 years/);
  assert.doesNotMatch(preview, /###META###/);
  assert.doesNotMatch(preview, /LEAD QUALITY BEHAVIOUR/);
  assert.doesNotMatch(preview, /FIELD VALUES GUIDE/);
});

test('paired tones stay distinct and preview skips the lawyer and broker intake form', () => {
  const paired = sanitizeAssistant({
    applied: true,
    personalities: ['luxury', 'caring'],
    communication_style: 'quick',
    formality: 'formal',
  }, 'agent');
  const pairedPrompt = buildAgentSystemPrompt(profile, { assistantSetting: paired });
  assert.match(pairedPrompt, /The greeting carries the first voice/);
  assert.match(pairedPrompt, /The question carries the second voice/);
  assert.doesNotMatch(pairedPrompt, /Good to meet you/);
  assert.doesNotMatch(pairedPrompt, /"Welcome"/);
  assert.match(pairedPrompt, /Do not describe or label the greeting/);
  assert.match(pairedPrompt, /Luxury: refined, private, and unhurried/);
  assert.doesNotMatch(pairedPrompt, /quiet hello/);
  assert.doesNotMatch(pairedPrompt, /discreet/);
  assert.match(pairedPrompt, /Caring: patient and reassuring/);
  assert.doesNotMatch(pairedPrompt, /whenever you're ready/i);
  assert.match(pairedPrompt, /The visitor is already here/);
  assert.doesNotMatch(pairedPrompt, /Sample shape/);

  const reminder = voiceTurnReminder(paired, 'hi');
  assert.match(reminder, /The greeting carries the first voice/);
  assert.match(reminder, /The question carries the second voice/);
  assert.match(reminder, /First voice — Luxury/);
  assert.match(reminder, /Second voice — Caring/);
  assert.match(reminder, /about 18 words, so both voices are clear/);
  assert.match(reminder, /Sound like a person texting/);
  assert.match(reminder, /Reply formality: formal/);
  assert.match(reminder, /The selected voice stays audible/);
  assert.doesNotMatch(reminder, /No slang, no contractions/);
  assert.match(reminder, /Ignore the tone of earlier assistant replies/);
  assert.equal(voiceTurnReminder({ ...paired, applied: false }, 'hi'), '');
  assert.match(voiceTurnReminder(paired, 'good morning!'), /The greeting carries the first voice/);
  assert.match(voiceTurnReminder(paired, 'Hi there'), /The greeting carries the first voice/);
  assert.match(voiceTurnReminder(paired, 'good night'), /The greeting carries the first voice/);
  assert.match(voiceTurnReminder(paired, 'how are you'), /Answer that in the selected voice/);
  assert.doesNotMatch(voiceTurnReminder(paired, 'how are you'), /The greeting carries the first voice/);
  assert.doesNotMatch(voiceTurnReminder(paired, 'hey how are you?'), /The greeting carries the first voice/);
  assert.match(pairedPrompt, /Keep both voices distinct inside the same short reply/);
  assert.doesNotMatch(pairedPrompt, /Blend this voice/);
  const answerReminder = voiceTurnReminder(paired, 'how many years of experience do you have');
  assert.match(answerReminder, /The answer carries the first voice/);
  assert.match(answerReminder, /The follow-up question carries the second voice/);
  assert.match(answerReminder, /Do not open with a hello/);
  assert.doesNotMatch(answerReminder, /The greeting carries the first voice/);

  const messages = withTurnReminder([
    { role: 'system', content: 'prompt' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'old tone' },
    { role: 'user', content: 'hello' },
  ], reminder);
  assert.equal(messages[3].role, 'system');
  assert.equal(messages[4].content, 'hello');
  assert.match(pairedPrompt, /about 18 words, so both voices are clear/);
  assert.match(pairedPrompt, /Skip a feelings sentence unless the visitor sounds worried/);
  assert.doesNotMatch(pairedPrompt, /Acknowledge the visitor's feelings briefly/);
  assert.doesNotMatch(pairedPrompt, /No slang, no contractions/);
  assert.match(pairedPrompt, /The selected voice stays audible/);
  assert.match(pairedPrompt, /Formality only limits slang, contractions, and exclamation marks/);
  assert.match(pairedPrompt, /The intake form already collects intent/);
  assert.match(buildOutOfScopeReply('agent', 'Sarah Johnson', paired), /Are you looking to purchase or to sell a property/);
  assert.match(buildEmptyTurnFallbackReply('agent', paired), /Please share a detail on buying or selling/);
  assert.doesNotMatch(buildEmptyTurnFallbackReply('agent', paired), /I'm here to help!/);

  const lawyerPreview = assistantSettingForPreview({
    applied: false,
    personalities: ['polished'],
    communication_style: 'educational',
    formality: 'formal',
  }, 'lawyer');
  const lawyer = buildLawyerSystemPrompt(profile, {
    assistantSetting: lawyerPreview,
    previewConversation: true,
  });
  assert.match(lawyer, /This preview has no intake form/);
  assert.match(lawyer, /the reply must start with a greeting/);
  assert.match(lawyer, /Polished opening: a formal hello/);
  assert.doesNotMatch(lawyer, /Good to meet you/);
  assert.match(lawyer, /purchase closing or a sale closing/);
  assert.match(lawyer, /purchase closing/);
  assert.doesNotMatch(lawyer, /yes am looking for/);
  assert.doesNotMatch(lawyer, /do not ask whether they are buying or selling/);
  assert.match(lawyer, /Polished: crisp, businesslike/);
  assert.match(lawyer, /Length: two short sentences. One plain fact, then one question/);
  assert.doesNotMatch(lawyer, /The lawyer intake form already collected/);
  const lawyerPreviewPrompt = buildPreviewChatPrompt('lawyer', profile, { assistantSetting: lawyerPreview });
  assert.match(lawyerPreviewPrompt, /a real estate lawyer/);
  assert.match(lawyerPreviewPrompt, /purchase closing or a sale closing/);
  assert.match(lawyerPreviewPrompt, /the agreement, the title, the parties/);
  assert.doesNotMatch(lawyerPreviewPrompt, /buy or sell/);
  assert.match(lawyer, /consultation with me/);
  assert.match(lawyer, /The greeting words can be fresh/);
  assert.match(lawyer, /yes without naming the closing/);
  assert.doesNotMatch(lawyer, /speak with the lawyer/);
  assert.match(voiceTurnReminder(lawyerPreview, 'yes'), /purchase closing or a sale closing/);
  assert.equal(
    guardLawyerReply('Hello! Are you looking to buy or sell a property?'),
    'Hello. Is this a purchase closing, a sale closing, or a refinance closing?',
  );
  assert.equal(
    guardLawyerReply('Hello! Are you looking to buy or sell a property?', { personalities: ['friendly'], formality: 'casual' }),
    'Hello! Is this a purchase closing, a sale closing, or a refinance closing?',
  );
  assert.equal(lawyerReplyDrifted('I can review the purchase agreement.'), false);
  assert.match(guardLawyerReply('For refinancing you need income verification and a credit score.'), /refinance closing/);
  assert.equal(assistantCatalog('lawyer').differentiators.find(([id]) => id === 'first_time')[1], 'First-time buyer closings');
  assert.equal(assistantCatalog('lawyer').qualification[0][1], 'Is this a purchase closing, a sale closing, or a refinance closing?');

  const brokerPreview = assistantSettingForPreview({
    applied: false,
    personalities: ['persuasive'],
    communication_style: 'consultative',
    formality: 'casual',
  }, 'mortgage_broker');
  const broker = buildMortgageBrokerSystemPrompt(profile, {
    assistantSetting: brokerPreview,
    previewConversation: true,
  });
  assert.match(broker, /This preview has no intake form/);
  assert.match(broker, /the reply must start with a greeting/);
  assert.match(broker, /Persuasive opening: a plain hello/);
  assert.match(broker, /a new mortgage or a refinance/);
  assert.match(broker, /refinance or a renewal/);
  assert.doesNotMatch(broker, /yes am looking for/);
  assert.doesNotMatch(broker, /do not ask whether they are buying or selling/);
  assert.match(voiceTurnReminder(brokerPreview, 'hi'), /a new mortgage or a refinance/);
  const brokerPreviewPrompt = buildPreviewChatPrompt('mortgage_broker', profile, { assistantSetting: brokerPreview });
  assert.match(brokerPreviewPrompt, /a mortgage broker/);
  assert.match(brokerPreviewPrompt, /a new mortgage or a refinance/);
  assert.match(brokerPreviewPrompt, /the loan amount, the term, or pre-approval/);
  assert.doesNotMatch(brokerPreviewPrompt, /buy or sell/);
  assert.match(broker, /Persuasive: confident and forward/);
  assert.match(broker, /Length: two short sentences. One observation, then one question/);
  assert.doesNotMatch(broker, /The mortgage intake form already collected/);
});

test('applied broker and lawyer controls override built-in persona and qualification prompts', () => {
  const cases = [
    {
      role: 'mortgage_broker',
      buildPrompt: buildMortgageBrokerSystemPrompt,
      qualification: ['purpose', 'timeline'],
    },
    {
      role: 'lawyer',
      buildPrompt: buildLawyerSystemPrompt,
      qualification: ['legal_service'],
    },
  ];

  for (const { role, buildPrompt, qualification } of cases) {
    const setting = sanitizeAssistant({
      applied: true,
      personalities: ['friendly'],
      communication_style: 'quick',
      formality: 'casual',
      qualification_questions: qualification,
      next_actions: ['schedule', 'save_lead'],
    }, role);
    const prompt = buildPrompt(profile, { assistantSetting: setting });

    assert.match(prompt, /CUSTOMIZATION PRIORITY — assistant style/);
    assert.match(prompt, /Friendly and approachable/);
    assert.match(prompt, /Friendly: easy, upbeat, texting rhythm/);
    assert.match(prompt, /Length: one short sentence, about 12 words/);
    assert.match(prompt, /Reply formality: casual/);
    assert.match(prompt, /Do not ask those questions again/);
    assert.doesNotMatch(prompt, /CUSTOMIZATION PRIORITY — qualification questions/);
    assert.doesNotMatch(prompt, /Do not ask for or prompt the visitor to provide contact details/);
    assert.doesNotMatch(prompt, /CUSTOMIZATION PRIORITY — CRM: Do not create or update/);
    assert.doesNotMatch(prompt, /Scheduling is off/);
  }
});

test('virtual consultations are prompted even without a geographic service area', () => {
  const setting = sanitizeAssistant({
    applied: true,
    virtual_consultations: true,
  }, 'lawyer');
  const prompt = appendAssistantOverlay('Role prompt', setting);

  assert.match(prompt, /Virtual consultations are available, including for visitors outside the saved physical service area/);
  assert.doesNotMatch(prompt, /Service area:/);
});

test('professional catalog does not offer callback, call transfer, or voice import settings', () => {
  const catalog = assistantCatalog('agent');
  const actionIds = catalog.next_actions.map(([id]) => id);
  assert.equal(actionIds.includes('callback'), false);
  assert.equal(actionIds.includes('transfer_call'), false);
  assert.equal('voice_accent' in catalog, false);
  assert.equal('website_import_url' in catalog, false);
});

test('customization does not turn lead saving off', () => {
  assert.equal(assistantAllowsLeadSaving(null), true);
  assert.equal(assistantAllowsLeadSaving({ applied: false, next_actions: [] }), true);
  assert.equal(assistantAllowsLeadSaving({ applied: true, next_actions: ['collect_contact'] }), true);
  assert.equal(assistantAllowsLeadSaving({ applied: true, next_actions: [] }), true);
});

test('professional identity settings sanitize, persist in prompts, and use profile defaults', () => {
  const setting = sanitizeAssistant({
    applied: true,
    bot_name: '  Maya  ',
    display_name: '  Maya Homes  ',
    bot_persona_title: 'Local property guide',
    welcome_message: 'Welcome to my chat.',
    signup_cta_copy: 'Create an account to continue.',
    consent_line: 'May I use your details to follow up?',
  }, 'agent');

  assert.equal(setting.bot_name, 'Maya');
  assert.equal(setting.display_name, 'Maya Homes');
  assert.equal(setting.bot_persona_title, 'Local property guide');
  assert.equal(setting.welcome_message, 'Welcome to my chat.');
  assert.equal(setting.signup_cta_copy, 'Create an account to continue.');
  assert.equal(setting.consent_line, 'May I use your details to follow up?');
  assert.match(appendAssistantOverlay('Role prompt', setting), /spoken assistant name is "Maya"/);
  assert.match(appendAssistantOverlay('Role prompt', setting), /rewritten in the selected voice and length: "Create an account to continue."/);
  assert.match(appendAssistantOverlay('Role prompt', setting), /in the selected voice and length: "May I use your details to follow up\?"/);
  assert.equal(prefillAssistant('agent', profile).display_name, 'Sarah Johnson');
});

test('saved service area keeps only matching property cards', () => {
  const setting = sanitizeAssistant({
    applied: true,
    cities: ['Toronto'],
    neighbourhoods: ['Leslieville'],
  }, 'agent');
  assert.equal(listingInsideServiceArea({ location: 'Leslieville, Toronto', address: '12 Queen St' }, setting), true);
  assert.equal(listingInsideServiceArea({ location: 'Vancouver', address: '9 Main St' }, setting), false);
  assert.equal(listingInsideServiceArea({ location: 'Vancouver' }, { applied: false, cities: ['Toronto'] }), true);
});

test('each professional role receives 12 default FAQs and can save at most 8 custom FAQs', () => {
  for (const role of ['agent', 'mortgage_broker', 'lawyer']) {
    const defaults = assistantFaqsForRole(role);
    assert.equal(defaults.length, 12);
    assert.ok(defaults.every((faq) => faq.is_default && faq.approved && faq.question && faq.answer));
    assert.equal(new Set(defaults.map((faq) => faq.id)).size, 12);
  }
  const replaced = assistantFaqsForRole('lawyer', [{
    id: 'lawyer-assistant-faq-01',
    is_default: true,
    question: 'Can you help with a home purchase closing?',
    answer: 'I can collect the property location and expected closing date so the lawyer can confirm whether they can assist and explain the process.',
  }]);
  assert.match(replaced[0].answer, /I handle purchase closings/);
  assert.doesNotMatch(replaced[0].answer, /property location/);
  const handEdited = assistantFaqsForRole('lawyer', [{
    id: 'lawyer-assistant-faq-01',
    is_default: true,
    question: 'Can you help with a home purchase closing?',
    answer: 'Tell me the property type and the features buyers will like.',
  }]);
  assert.match(handEdited[0].answer, /I handle purchase closings/);
  const customLawyer = assistantFaqsForRole('lawyer', [{
    is_default: false,
    question: 'Do you review condo documents?',
    answer: 'Yes. I review the condo documents for the closing.',
  }]);
  assert.ok(customLawyer.some((faq) => faq.question === 'Do you review condo documents?'));

  const custom = Array.from({ length: 9 }, (_, index) => ({
    id: `custom-${index}`,
    question: `Question ${index}`,
    answer: `Answer ${index}`,
    approved: true,
  }));
  const merged = assistantFaqsForRole('agent', custom);
  assert.equal(merged.filter((faq) => faq.is_default).length, 12);
  assert.equal(merged.filter((faq) => !faq.is_default).length, 8);
  assert.equal(draftFaqs({ role: 'agent', faqs: merged }, profile).length, 0);
});

test('lawyer studio settings reach the lawyer chat', () => {
  const onlyTitle = sanitizeAssistant({
    applied: true,
    qualification_questions: ['legal_service', 'transaction_value'],
    hot_guidance: 'Signed agreement and closing this month.',
  }, 'lawyer');
  const preview = buildPreviewChatPrompt('lawyer', profile, { assistantSetting: onlyTitle });
  assert.match(preview, /ask one question about the title\./);
  assert.doesNotMatch(preview, /ask one question about the agreement/);
  assert.match(preview, /Are there any title or document questions\?/);
  assert.match(preview, /Ready to act: Signed agreement and closing this month\./);

  const everything = sanitizeAssistant({
    applied: true,
    qualification_questions: ['legal_service', 'location', 'transaction_type', 'transaction_value', 'closing_date', 'urgency'],
  }, 'lawyer');
  const publicPrompt = buildLawyerSystemPrompt(profile, { assistantSetting: everything });
  assert.match(publicPrompt, /The intake form already has the closing type, the location, the closing date/);
  assert.match(publicPrompt, /do not ask it again/);
  assert.doesNotMatch(publicPrompt, /On every later reply, ask one question about the title or the parties/);
  assert.doesNotMatch(publicPrompt, /Which jurisdiction is the property in\?/);
  assert.match(publicPrompt, /acknowledge it in one short sentence|Acknowledge the intake answers in one short sentence/);
  assert.doesNotMatch(publicPrompt, /Recap once and ask confirmation/);
  assert.match(voiceTurnReminder(everything, 'ok next', { preview: true }), /the agreement, the title, the parties, the jurisdiction, or the closing timeline/);

  const edited = assistantFaqsForRole('lawyer', [{
    id: 'lawyer-assistant-faq-05',
    is_default: true,
    question: 'Can you help with a title search?',
    answer: 'Yes. I order the title search and review it with you before closing.',
  }]);
  assert.equal(edited[4].answer, 'Yes. I order the title search and review it with you before closing.');

  const suggestions = draftFaqs({ role: 'lawyer', services: ['title_search'], jurisdictions: ['Ontario'], faqs: [] }, profile);
  assert.match(suggestions[0].answer, /^I help clients with title searches in Ontario\./);

  assert.equal(lawyerReplyDrifted('I handle the refinance closing documents, and your lender handles the interest rate.'), false);
  assert.equal(lawyerReplyDrifted('What is your current interest rate?'), true);
  assert.equal(
    guardLawyerReply('Are you looking to buy or sell?', {
      personalities: ['polished', 'caring'],
      communication_style: 'educational',
    }),
    'I can certainly help with this closing. Each closing type has its own documents and title steps. Could you tell me if this is a purchase closing, a sale closing, or a refinance closing?',
  );
  assert.match(buildEmptyTurnFallbackReply('lawyer', { applied: true, personalities: ['caring'] }), /purchase closing/);
  assert.doesNotMatch(buildEmptyTurnFallbackReply('lawyer', { applied: true, personalities: ['caring'] }), /Whenever/);
  assert.equal(
    finishLawyerReply('I can assist with title transfers as well! Could you please share the names of the parties involved in the title transfer?', {
      previousReply: 'Could you please share the names of the parties involved in this refinancing?',
    }),
    'I can assist with title transfers.',
  );
  assert.equal(
    finishLawyerReply('Are you looking to buy or sell in these areas?', {
      userMessage: 'in which areas your are seing',
      setting: { jurisdictions: ['Ontario'] },
    }),
    'I am licensed in Ontario.',
  );
});

test('manual custom Q&A works like admin while generated suggestions require approval', () => {
  const longAnswer = `First line\n${'A'.repeat(1190)}`;
  const setting = sanitizeAssistant({
    applied: true,
    faqs: [
      {
        id: 'manual-faq',
        question: 'Can you help with relocation?',
        answer: longAnswer,
        is_default: false,
        approved: false,
        source: 'manual',
      },
      {
        id: 'generated-faq',
        question: 'Can you help with financing?',
        answer: 'I can share general financing information.',
        is_default: false,
        approved: false,
        source: 'generated',
      },
    ],
  }, 'agent');

  assert.equal(setting.faqs.find((faq) => faq.id === 'manual-faq').approved, true);
  assert.equal(setting.faqs.find((faq) => faq.id === 'manual-faq').answer.length, 1200);
  assert.match(setting.faqs.find((faq) => faq.id === 'manual-faq').answer, /\n/);
  assert.equal(setting.faqs.find((faq) => faq.id === 'generated-faq').approved, false);
  const prompt = appendAssistantOverlay('Role prompt', setting);
  assert.match(prompt, /Can you help with relocation/);
  assert.doesNotMatch(prompt, /Can you help with financing/);

  const suggestions = draftFaqs({ role: 'agent', services: ['buying'], faqs: [] }, profile);
  assert.ok(suggestions.every((faq) => faq.id && faq.source === 'generated' && !faq.approved));
  assert.equal(new Set(suggestions.map((faq) => faq.id)).size, suggestions.length);
});
