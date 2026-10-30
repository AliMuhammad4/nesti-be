import test from 'node:test';
import assert from 'node:assert/strict';
import { chatAnsweredQuestionIds, intakeHasHelloAnswer, openQualificationQuestionIds, qualificationStillOpen } from '../services/professionalAssistant/qualificationProgress.js';
import { dropRepeatedVisitorName, replyLanguage } from '../services/professionalAssistant/replyStyle.js';
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
  finishAgentReply,
  finishBrokerReply,
  finishLawyerReply,
  guardLawyerReply,
  lawyerReplyDrifted,
  buildPreviewChatPrompt,
  prefillAssistant,
  sanitizeAssistant,
  voiceTurnReminder,
} from '../services/professionalAssistant/professionalAssistantService.js';
import { withTurnReminder } from '../services/chat/handleChat/chatOpenAiTurn.js';
import { PERSONALITIES, QUALIFICATION_TEMPLATES, legacyPersonalityId } from '../services/professionalAssistant/catalog.js';
import {
  applyProfileIdentity,
  clientTypeForForm,
  questionLabel,
  questionOptions,
  sanitizeQualificationTemplates,
  settingForClientType,
} from '../services/professionalAssistant/assistantSettings.js';
import { quickRepliesForReply } from '../services/professionalAssistant/qualificationProgress.js';
import { buildAgentSystemPrompt } from '../services/chat/prompts/agentPrompt.js';
import { buildLawyerSystemPrompt } from '../services/chat/prompts/lawyerPrompt.js';
import { buildMortgageBrokerSystemPrompt } from '../services/chat/prompts/mortgageBrokerPrompt.js';
import { buildEmptyTurnFallbackReply, buildOutOfScopeReply } from '../services/chat/utils/chatScopeGuard.js';
import { identityReply, professionalExpertiseLabels } from '../services/chat/utils/profileVisitorFacts.js';

const profile = { full_name: 'Sarah Johnson', company_name: 'RE/MAX', location: 'Toronto', languages_spoken: ['english', 'french'], country: 'Canada' };

test('a later reply drops the visitor name and the first greeting may keep it', () => {
  assert.equal(
    dropRepeatedVisitorName('Thank you for that, Facilis. Lahore is a wonderful choice. What is the approximate property value?', 'Facilis'),
    'Thank you. Lahore is a wonderful choice. What is the approximate property value?',
  );
  assert.equal(
    dropRepeatedVisitorName('Hi Facilis, glad you are here. What area are you considering?', 'Facilis', { keepName: true }),
    'Hi Facilis, glad you are here. What area are you considering?',
  );
  const later = buildMortgageBrokerSystemPrompt(profile, {
    assistantSetting: sanitizeAssistant({ applied: true, address_by_first_name: true }, 'mortgage_broker'),
    openingTurn: false,
    intakeFormContact: { name: 'Facilis', address: 'Lahore' },
  });
  assert.match(later, /Do not say the visitor's name/);
  assert.match(later, /without their name/);
  assert.equal(
    dropRepeatedVisitorName('Lahore is a wonderful choice for Facilis today.', 'Facilis'),
    'Lahore is a wonderful choice for today.',
  );
  assert.equal(
    dropRepeatedVisitorName('My name is Facilis. I help with mortgages.', 'Facilis'),
    'My name is Facilis. I help with mortgages.',
  );
});

test('the first live reply greets, a later hello skips a form answer, and a chat answer closes that question', () => {
  const broker = sanitizeAssistant({
    applied: true,
    qualification_questions: ['location', 'amount'],
  }, 'mortgage_broker');
  const opening = voiceTurnReminder(broker, 'Hi! My name is Facilis. Target area: Lahore.', { openingTurn: true });
  assert.match(opening, /Start with a short greeting/);
  assert.doesNotMatch(opening, /Do not open with a hello/);
  const hello = voiceTurnReminder(broker, 'hi', { intakeFormContact: { purchase_purpose: 'investment' } });
  assert.match(hello, /do not ask it again/);
  assert.doesNotMatch(hello, /a new mortgage or a refinance/);
  assert.equal(intakeHasHelloAnswer(broker, { purchase_purpose: 'investment' }), true);
  const history = [{ role: 'assistant', content: 'Where is the property located?' }];
  const answered = chatAnsweredQuestionIds(broker, history, 'yeah location will be in lahore');
  assert.deepEqual(answered, ['location']);
  assert.equal(qualificationStillOpen(broker, { address: 'Lahore' }, answered), true);
  assert.equal(qualificationStillOpen(broker, { address: 'Lahore', financing_amount: '400000' }, answered), false);
  const prompt = buildMortgageBrokerSystemPrompt(profile, {
    assistantSetting: broker,
    intakeFormContact: { address: 'Lahore', purchase_purpose: 'investment' },
    chatAnsweredQuestions: ['location'],
    isAutomatedBookingEnabled: true,
    calendlyLink: 'https://calendly.com/broker/intro',
  });
  assert.match(prompt, /What financing amount are you considering/);
  assert.doesNotMatch(prompt, /Where is the property located/);
});

test('auto detect follows the visitor and keeps that language on a short reply', () => {
  const setting = { languages: ['english', 'french', 'spanish', 'arabic'], auto_detect_language: true };
  assert.equal(replyLanguage(setting, 'bonjour'), 'french');
  assert.equal(replyLanguage(setting, 'how are you', 'bonjour'), 'french');
  assert.equal(replyLanguage(setting, 'hola'), 'spanish');
  assert.equal(replyLanguage(setting, 'not yet', 'hola necesito una hipoteca'), 'spanish');
  assert.equal(replyLanguage(setting, 'salam'), 'arabic');
  assert.equal(replyLanguage(setting, 'كيف حالك'), 'arabic');
  assert.equal(replyLanguage(setting, 'I want to apply for a new mortgage', 'salam'), 'english');
  assert.equal(replyLanguage({ languages: ['english'], auto_detect_language: true }, 'salam'), 'arabic');
  assert.equal(replyLanguage({ languages: ['english'], auto_detect_language: false }, 'salam'), 'english');
  assert.equal(replyLanguage({ languages: ['english'], auto_detect_language: true }, 'ola'), 'spanish');
  assert.equal(
    finishAgentReply('¡Hola! ¿Estás buscando comprar o vender una propiedad? 🏠', {
      userMessage: 'hola',
      setting: { languages: ['english'], auto_detect_language: true, use_emojis: true },
    }),
    '¡Hola! ¿Estás buscando comprar o vender una propiedad? 👋',
  );
  assert.equal(
    finishAgentReply('ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਤੁਸੀਂ ਕੀ ਖਰੀਦਣ ਜਾਂ ਵੇਚਣ ਦੀ ਸੋਚ ਰਹੇ ਹੋ? 🏠', {
      userMessage: 'sat sri akal',
      setting: { languages: ['english'], auto_detect_language: true, use_emojis: true },
    }),
    'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਤੁਸੀਂ ਕੀ ਖਰੀਦਣ ਜਾਂ ਵੇਚਣ ਦੀ ਸੋਚ ਰਹੇ ਹੋ? 👋',
  );
  assert.equal(replyLanguage({ ...setting, auto_detect_language: false }, 'bonjour'), 'english');
});

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
  assert.match(withYears, /If the visitor asks your name, answer "My name is Sarah Johnson\."/);
  assert.match(withYears, /List every saved service and expertise item/);
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
  assert.equal(
    identityReply({
      userMessage: 'ap ka name kiya ha',
      profile: experienced,
      setting,
    }),
    'My name is Sarah Johnson. I help with Luxury real estate, Relocation services, Personalized one-on-one service, Condo investors.',
  );
  assert.equal(
    identityReply({
      userMessage: 'what is your name',
      profile: experienced,
      setting,
      yearsExperience: 12,
    }),
    'My name is Sarah Johnson. I help with Luxury real estate, Relocation services, Personalized one-on-one service, Condo investors.',
  );

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
  assert.match(prompt, /Trusted Expert — Professional, knowledgeable, reassuring/);
  assert.match(prompt, /Quick and direct\. Short, concise responses/);
  assert.match(prompt, /Reply formality: professional\. Use clear professional language/);
  assert.match(prompt, /Do not flatten every reply into a generic warm, concise, professional voice/);
  assert.doesNotMatch(prompt, /When are you planning to buy or sell/);
  assert.doesNotMatch(prompt, /What is your purchase budget or expected selling price/);
  assert.doesNotMatch(prompt, /Have you been pre-approved for a mortgage/);
  assert.match(prompt, /The intake form already has intent, location, budget, timeline, property type, and mortgage status/);
  assert.match(prompt, /What is your preferred timeline/);
  assert.match(prompt, /What is your approximate budget/);
  assert.doesNotMatch(prompt, /Are you currently working with a realtor/);
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
  assert.match(prompt, /Scheduling is off/);
  assert.doesNotMatch(prompt, /Do not ask for or prompt the visitor to provide contact details/);
  assert.match(prompt, /Professional-approved assistant settings/);
  assert.match(prompt, /Sarah Johnson/);
  assert.match(prompt, /Speak as this professional in the first person/);
  assert.doesNotMatch(prompt, /speaking on Sarah Johnson's behalf/);
  assert.doesNotMatch(prompt, /show this expertise as a short bullet list/);
  assert.match(prompt, /Buying a home/);
  assert.match(prompt, /Do you cover Toronto/);
  assert.doesNotMatch(prompt, /Hidden/);
  assert.match(prompt, /Do not offer a booking link/);
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
  assert.match(lawyer, /Trusted Expert/);
  assert.match(lawyer, /Educational \(fact then question\)/);
  assert.match(lawyer, /The lawyer intake form already collected/);
  assert.doesNotMatch(lawyer, /What is your expected closing date/);
  assert.doesNotMatch(lawyer, /Calm, professional, reassuring/);
  assert.doesNotMatch(lawyer, /Are you working with a realtor/);
  assert.match(lawyer, /Scheduling is off/);
  assert.doesNotMatch(lawyer, /Hot —/);

  const brokerSetting = sanitizeAssistant({
    applied: true,
    personalities: ['caring'],
    qualification_questions: ['timeline'],
    next_actions: ['collect_contact'],
  }, 'mortgage_broker');
  const broker = buildMortgageBrokerSystemPrompt({ full_name: 'Sam Broker', location: 'Calgary' }, { assistantSetting: brokerSetting });
  assert.match(broker, /Friendly Advisor/);
  assert.match(broker, /The mortgage intake form already collected/);
  assert.match(broker, /What is your preferred financing timeline/);
  assert.match(broker, /only when that detail is still missing/);
  const withIntake = buildMortgageBrokerSystemPrompt({ full_name: 'Sam Broker', location: 'Calgary' }, {
    assistantSetting: sanitizeAssistant({
      applied: true,
      personalities: ['caring'],
      qualification_questions: ['location', 'timeline', 'amount'],
      next_actions: ['collect_contact', 'schedule'],
    }, 'mortgage_broker'),
    intakeFormContact: {
      address: 'Nesciunt minus sit',
      mortgage_timeline: 'immediately',
      pre_approval_status: 'need_now',
      budget: 'under_400k',
      purchase_purpose: 'investment',
    },
  });
  assert.match(withIntake, /property location/);
  assert.match(withIntake, /What financing amount are you considering/);
  assert.match(withIntake, /Do not share a meeting link in that reply/);
  assert.doesNotMatch(withIntake, /Where is the property located/);
  assert.doesNotMatch(withIntake, /What is your preferred financing timeline/);
  assert.doesNotMatch(broker, /calm, kind, and emotionally aware/);
  assert.doesNotMatch(broker, /What is your approximate credit score/);
  assert.match(broker, /Scheduling is off/);
  assert.doesNotMatch(broker, /Do not ask for or prompt the visitor to provide contact details/);

  const lawyerBeforeMeeting = buildLawyerSystemPrompt({ full_name: 'Ada Counsel', location: 'Ottawa' }, {
    assistantSetting: sanitizeAssistant({
      applied: true,
      qualification_questions: ['location', 'transaction_value'],
      next_actions: ['collect_contact', 'schedule'],
    }, 'lawyer'),
    isAutomatedBookingEnabled: true,
    calendlyLink: 'https://calendly.com/lawyer/intro',
    intakeFormContact: {
      address: '12 Main Street',
      legal_services_needed: 'purchase_closing',
      transaction_stage: 'offer_accepted',
      closing_timeline: 'within_30_days',
    },
  });
  assert.match(lawyerBeforeMeeting, /title or document questions/);
  assert.match(lawyerBeforeMeeting, /Do not include a booking URL yet/);
  assert.match(lawyerBeforeMeeting, /rest of the details/);
  assert.doesNotMatch(lawyerBeforeMeeting, /Which jurisdiction is the property in/);
  assert.doesNotMatch(lawyerBeforeMeeting, /add the booking URL exactly once/);
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

  const beforeMeeting = buildAgentSystemPrompt(profile, {
    assistantSetting: sanitizeAssistant({
      applied: true,
      qualification_questions: ['location', 'timeline', 'budget'],
      next_actions: ['collect_contact', 'schedule'],
    }, 'agent'),
    isAutomatedBookingEnabled: true,
    calendlyLink: 'https://calendly.com/agent/intro',
    intakeFormContact: {
      intent: 'buy',
      address: 'North York',
      timeline: '1-3 months',
    },
  });
  assert.match(beforeMeeting, /What is your approximate budget/);
  assert.match(beforeMeeting, /Do not share a meeting link in that reply/);
  assert.match(beforeMeeting, /rest of the details/);
  assert.match(beforeMeeting, /You are Sarah Johnson/);
  assert.doesNotMatch(beforeMeeting, /What location are you interested in/);
  assert.doesNotMatch(beforeMeeting, /What is your preferred timeline/);
  assert.doesNotMatch(beforeMeeting, /add the booking URL exactly once/);
  assert.doesNotMatch(beforeMeeting, /working on behalf of/);

  const brokerBeforeMeeting = buildMortgageBrokerSystemPrompt(profile, {
    assistantSetting: sanitizeAssistant({
      applied: true,
      qualification_questions: ['amount'],
      next_actions: ['collect_contact', 'schedule'],
    }, 'mortgage_broker'),
    isAutomatedBookingEnabled: true,
    calendlyLink: 'https://calendly.com/broker/intro',
    intakeFormContact: {
      address: 'North York',
      purchase_purpose: 'investment',
      budget: 'under_400k',
      mortgage_timeline: 'immediately',
      pre_approval_status: 'need_now',
    },
  });
  assert.match(brokerBeforeMeeting, /What financing amount are you considering/);
  assert.match(brokerBeforeMeeting, /Do not include a booking URL yet/);
  assert.doesNotMatch(brokerBeforeMeeting, /add the booking URL exactly once/);
  assert.doesNotMatch(brokerBeforeMeeting, /Scheduling is off/);
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
  assert.equal(PERSONALITIES.length, 5);
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
  assert.match(prompt, /Friendly Advisor/);
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
  assert.match(preview, /Friendly: easy, upbeat, texting rhythm/);
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
  assert.match(pairedPrompt, /Friendly: easy, upbeat, texting rhythm/);
  assert.doesNotMatch(pairedPrompt, /whenever you're ready/i);
  assert.match(pairedPrompt, /The visitor is already here/);
  assert.doesNotMatch(pairedPrompt, /Sample shape/);

  const reminder = voiceTurnReminder(paired, 'hi');
  assert.match(reminder, /The greeting carries the first voice/);
  assert.match(reminder, /The question carries the second voice/);
  assert.match(reminder, /First voice — Luxury/);
  assert.match(reminder, /Second voice — Friendly/);
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
  assert.match(pairedPrompt, /The intake form may already have intent, location, budget, timeline, property type, and mortgage status/);
  assert.match(buildOutOfScopeReply('agent', 'Sarah Johnson', paired), /Are you looking to purchase or to sell a property/);
  assert.match(buildEmptyTurnFallbackReply('agent', paired), /Please share a detail on buying or selling/);
  assert.doesNotMatch(buildEmptyTurnFallbackReply('agent', paired), /I'm here to help!/);

  const lawyerPreview = assistantSettingForPreview({
    applied: false,
    personalities: ['polished'],
    communication_style: 'educational',
    formality: 'formal',
    qualification_questions: ['legal_service', 'location', 'transaction_type', 'transaction_value', 'closing_date', 'urgency'],
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
  assert.match(voiceTurnReminder(lawyerPreview, 'yes', { preview: true }), /purchase closing or a sale closing/);
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
    qualification_questions: ['purpose', 'amount', 'timeline', 'preapproval'],
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
  assert.match(brokerPreviewPrompt, /the financing amount, the financing timeline, or pre-approval/);
  assert.doesNotMatch(brokerPreviewPrompt, /buy or sell/);
  assert.match(broker, /Persuasive: confident, direct, and efficient/);
  assert.match(broker, /Length: two short sentences. One observation, then one question/);
  assert.doesNotMatch(broker, /The mortgage intake form already collected/);
  assert.match(brokerPreviewPrompt, /do not ask it again/);
  assert.match(voiceTurnReminder(brokerPreview, 'nope'), /Do not ask that question again/);
  assert.equal(
    finishBrokerReply('Are you considering a new mortgage or a refinance?', {
      userMessage: 'nope',
      previousReply: 'Hello! Are you looking for a new mortgage or a refinance?',
    }),
    'What is the mortgage, then? A renewal, or a file you already started?',
  );
  assert.equal(
    finishBrokerReply('Are you considering a new mortgage or a refinance?', {
      userMessage: 'nope',
      previousReply: 'Hello. Are you looking for a new mortgage or a refinance?',
      setting: { personalities: ['friendly'], communication_style: 'conversational', formality: 'casual' },
    }),
    'Happy to help! Is it a renewal, or do you already have a pre-approval?',
  );
  assert.equal(
    finishBrokerReply('Are you considering a new mortgage or a refinance?', {
      userMessage: 'nope',
      previousReply: 'Hello. Are you looking for a new mortgage or a refinance?',
      setting: { personalities: ['polished'], communication_style: 'quick', formality: 'formal' },
    }),
    'Is this a renewal, or do you already have a pre-approval?',
  );
  assert.equal(
    finishBrokerReply('Are you looking to buy or sell a property?', {
      userMessage: 'hi',
      setting: { personalities: ['caring'], communication_style: 'educational', formality: 'professional' },
    }),
    'Hello, I am glad you reached out. A new mortgage and a refinance start from different documents. Could you tell me if this is a new mortgage or a refinance?',
  );
  const amountOnly = assistantSettingForPreview({
    qualification_questions: ['amount'],
    personalities: ['polished'],
  }, 'mortgage_broker');
  const amountPrompt = buildPreviewChatPrompt('mortgage_broker', profile, { assistantSetting: amountOnly });
  assert.match(amountPrompt, /On a hello, the one question is about the financing amount/);
  assert.doesNotMatch(amountPrompt, /On a hello, the one question is whether this is a new mortgage or a refinance/);
  assert.equal(
    finishBrokerReply('Are you considering a new mortgage or a refinance?', {
      userMessage: 'nope',
      previousReply: 'Hello. Are you looking for a new mortgage or a refinance?',
      setting: {
        personalities: ['friendly'],
        communication_style: 'conversational',
        formality: 'casual',
        qualification_questions: ['purpose'],
      },
    }),
    'Happy to help! Is it a renewal?',
  );
  assert.equal(
    finishBrokerReply('Are you considering a new mortgage or a refinance?', {
      userMessage: 'nope',
      previousReply: 'Hello. Are you looking for a new mortgage or a refinance?',
      setting: {
        personalities: ['polished'],
        communication_style: 'quick',
        formality: 'formal',
        qualification_questions: ['amount'],
      },
    }),
    'What financing amount should I plan for?',
  );
  assert.equal(
    finishBrokerReply('Are you considering a new mortgage or a refinance?', {
      userMessage: 'nope',
      previousReply: 'Hello. Are you looking for a new mortgage or a refinance?',
      setting: {
        languages: ['french'],
        personalities: ['friendly'],
        communication_style: 'conversational',
        formality: 'casual',
      },
    }),
    'Avec plaisir! Est-ce un renouvellement, ou avez-vous déjà une préautorisation?',
  );
  assert.equal(
    finishBrokerReply('I can look at the file. Do you already have a mortgage pre-approval?', {
      previousReply: 'Do you already have a pre-approval?',
      setting: { personalities: ['polished'], formality: 'formal' },
    }),
    'I can look at the file.',
  );
  assert.equal(
    finishBrokerReply('I understand. I can review that renewal.', {
      setting: { personalities: ['friendly'], communication_style: 'conversational', formality: 'casual' },
    }),
    'Happy to help! I can review that renewal.',
  );
  assert.equal(
    finishBrokerReply('Hello! Are you looking for a new mortgage or a refinance?', {
      setting: { personalities: ['polished'], communication_style: 'quick', formality: 'formal' },
    }),
    'Hello. Is this a new mortgage or a refinance?',
  );
  assert.equal(
    finishBrokerReply('Are you looking to buy or sell?', {
      userMessage: 'bonjour',
      setting: { languages: ['french'], personalities: ['friendly'], communication_style: 'quick', formality: 'casual' },
    }),
    'Bonjour, content de vous voir. Est-ce un nouveau prêt ou un refinancement?',
  );
  assert.equal(
    finishBrokerReply('Are you looking to buy or sell?', {
      userMessage: 'bonjour',
      setting: { languages: ['english', 'french'], personalities: ['friendly'], communication_style: 'quick', formality: 'casual' },
    }),
    'Bonjour, content de vous voir. Est-ce un nouveau prêt ou un refinancement?',
  );
  assert.match(
    finishBrokerReply('Are you looking to buy or sell?', {
      userMessage: 'hola',
      setting: { languages: ['english', 'spanish'], personalities: ['friendly'], communication_style: 'quick', formality: 'casual' },
    }),
    /^Hola, me alegra que esté aquí\. ¿Es una hipoteca nueva/,
  );
  assert.match(
    finishBrokerReply("I'm glad you're here. Is this a new mortgage or a refinance?", {
      userMessage: 'ola',
      setting: { languages: ['english'], personalities: ['friendly'], communication_style: 'quick', formality: 'casual' },
    }),
    /^Hola, me alegra que esté aquí\. ¿Es una hipoteca nueva/,
  );
  assert.match(
    finishBrokerReply('Are you looking to buy or sell?', {
      userMessage: '你好',
      setting: { languages: ['english', 'mandarin'], personalities: ['polished'], communication_style: 'quick', formality: 'formal' },
    }),
    /您好/,
  );
  assert.equal(
    finishBrokerReply('Are you looking to buy or sell a property?', {
      userMessage: 'أريد شراء منزل',
      setting: { languages: ['arabic'], personalities: ['caring'], communication_style: 'educational', formality: 'professional' },
    }),
    'Are you looking to buy or sell a property?',
  );
  assert.match(
    finishBrokerReply('What is the approximate value of the property?', {
      previousReply: 'How soon do you need the financing?',
      history: [
        { role: 'assistant', content: 'What is the approximate value of the property?' },
        { role: 'user', content: 'we can talk about that later' },
        { role: 'assistant', content: 'How soon do you need the financing?' },
      ],
      setting: { personalities: ['polished'], formality: 'formal' },
    }),
    /approximate value/,
  );
  assert.equal(
    finishBrokerReply('What is the approximate value of the property?', {
      previousReply: 'How soon do you need the financing?',
      history: [
        { role: 'assistant', content: 'What is the approximate value of the property?' },
        { role: 'user', content: 'about 500000' },
        { role: 'assistant', content: 'How soon do you need the financing?' },
      ],
      setting: { personalities: ['polished'], formality: 'formal' },
    }),
    'I can certainly help',
  );
  assert.equal(
    finishBrokerReply('Hello.', {
      previousReply: 'What financing amount are you considering?',
      history: [
        { role: 'assistant', content: 'Hello. 👋' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'What financing amount are you considering?' },
      ],
      setting: { personalities: ['friendly'], formality: 'casual', use_emojis: true },
    }),
    'Hello. 👋',
  );
  assert.equal(
    finishBrokerReply('How much are you hoping to borrow?', {
      previousReply: 'What financing amount are you considering?',
      setting: { personalities: ['polished'], formality: 'formal' },
    }),
    'I can certainly help',
  );
  assert.equal(
    finishBrokerReply('Are you considering a new mortgage or a refinance?', {
      userMessage: 'nope',
      previousReply: 'Hello. Are you looking for a new mortgage or a refinance?',
      setting: {
        personalities: ['warm-counsel'],
        communication_style: 'conversational',
        formality: 'professional',
        custom_tones: [{
          id: 'warm-counsel',
          name: 'Warm counsel',
          guidance: 'Use short warm sentences and never sound stiff when you reply to the visitor.',
        }],
      },
    }),
    'I will keep this warm counsel. Is this a renewal, or do you already have a pre-approval?',
  );
  assert.equal(
    finishBrokerReply('Hello.', {
      setting: { personalities: ['friendly'], formality: 'casual', use_emojis: true },
    }),
    'Hello. 👋',
  );
  assert.equal(
    finishBrokerReply('Hello! Are you looking for a new mortgage or a refinance?', {
      setting: { personalities: ['friendly'], communication_style: 'quick', formality: 'casual', use_emojis: true },
    }),
    'Hello! Is it a new mortgage or a refinance? 👋',
  );
  assert.equal(
    finishBrokerReply('Good day. Is this about a new mortgage or a refinance?', {
      setting: { personalities: ['polished'], communication_style: 'quick', formality: 'formal', use_emojis: true },
    }),
    'Good day. Is this a new mortgage or a refinance? 👋',
  );
  assert.equal(
    finishBrokerReply('Hello! Are you looking for a new mortgage or a refinance?', {
      userMessage: 'hello',
      setting: { personalities: ['caring'], communication_style: 'educational', formality: 'casual', use_emojis: true },
    }),
    'Hello, I am glad you reached out! A new mortgage and a refinance start from different documents. Could you tell me if this is a new mortgage or a refinance? 👋',
  );
  assert.equal(
    finishBrokerReply('I am doing well, thank you.', {
      userMessage: 'how are you',
      previousReply: 'Good day. Is this a new mortgage or a refinance? 👋',
      setting: { personalities: ['polished'], communication_style: 'quick', formality: 'formal', use_emojis: true },
    }),
    'I am doing well, thank you. 🙂',
  );
  assert.equal(
    finishBrokerReply('I can assist with renewals or discuss if you already have a pre-approval. Which one applies to your situation?', {
      userMessage: 'nope',
      previousReply: 'A new mortgage and a refinance start from different documents. Could you tell me if this is a new mortgage or a refinance? 👋',
      setting: { personalities: ['caring'], communication_style: 'educational', formality: 'casual', use_emojis: true },
    }),
    'I can assist with renewals or discuss if you already have a pre-approval. Which one applies to your situation? 🙂',
  );
  assert.equal(
    finishBrokerReply('Acquiring a property is an exceptional journey, and a two-month timeline allows for thoughtful planning. What is the approximate value of the property you are considering?', {
      userMessage: 'yes i want to purchase property and it will take 2 moths',
      previousReply: 'Renewing a mortgage involves extending your current loan terms. Have you thought about what your goals are for this renewal? 🤝',
      setting: { personalities: ['luxury'], communication_style: 'educational', formality: 'casual', use_emojis: true },
    }),
    'Acquiring a property is an exceptional journey, and a two-month timeline allows for thoughtful planning. What is the approximate value of the property you are considering? 🏡',
  );
  assert.equal(
    finishBrokerReply('A property value of $50,000 is quite manageable and opens up various options. Have you already obtained a mortgage pre-approval for this purchase?', {
      userMessage: '50000$',
      previousReply: 'Acquiring a property is an exceptional journey. What is the approximate value of the property you are considering? 🏡',
      setting: { personalities: ['luxury'], communication_style: 'educational', formality: 'casual', use_emojis: true },
    }),
    'A property value of $50,000 is quite manageable and opens up various options. Have you already obtained a mortgage pre-approval for this purchase?',
  );
  assert.equal(
    finishBrokerReply('I can share a time. Would you like to book a call?', {
      previousReply: 'Hello. 👋',
      setting: { personalities: ['friendly'], formality: 'casual', use_emojis: true },
    }),
    'I can share a time. Would you like to book a call? 📅',
  );
  assert.equal(
    finishBrokerReply('What financing amount are you considering? 😊', {
      setting: { personalities: ['friendly'], formality: 'casual', use_emojis: true },
    }),
    'What financing amount are you considering? 🙂',
  );
  const noQuestions = assistantSettingForPreview({
    qualification_questions: [],
    personalities: ['polished'],
  }, 'mortgage_broker');
  const quietHello = buildPreviewChatPrompt('mortgage_broker', profile, { assistantSetting: noQuestions });
  assert.match(quietHello, /greet in the selected voice and do not add a question/);
  assert.doesNotMatch(quietHello, /On a hello, the one question is whether this is a new mortgage or a refinance/);
  const publicBroker = buildMortgageBrokerSystemPrompt(profile, {
    assistantSetting: sanitizeAssistant({
      applied: true,
      personalities: ['polished'],
      hot_guidance: 'Pre-approval needed this month.',
      next_actions: ['schedule'],
      qualification_questions: ['purpose', 'timeline'],
    }, 'mortgage_broker'),
  });
  assert.match(publicBroker, /Speak in the first person/);
  assert.match(publicBroker, /consultation with me/);
  assert.match(publicBroker, /call with me/);
  assert.doesNotMatch(publicBroker, /with Sarah Johnson/);
  assert.doesNotMatch(publicBroker, /timeline, pre-approval, credit score/);
  assert.doesNotMatch(publicBroker, /on behalf of/);
  assert.doesNotMatch(publicBroker, /Recap once and ask confirmation/);
  assert.match(publicBroker, /Ready to act: Pre-approval needed this month/);
  assert.match(publicBroker, /the financing timeline/);
  const brokerSuggestions = draftFaqs({ role: 'mortgage_broker', services: ['renewal'], faqs: [] }, profile);
  assert.match(brokerSuggestions[0].answer, /^I help clients with mortgage renewals/);
  assert.doesNotMatch(buildEmptyTurnFallbackReply('mortgage_broker', { applied: true, personalities: ['caring'] }), /Whenever/);
  assert.doesNotMatch(buildOutOfScopeReply('mortgage_broker', 'Alex Broker', { applied: true, personalities: ['caring'] }), /Alex Broker/);
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
    assert.match(prompt, /Friendly Advisor/);
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

test('an applied assistant can turn lead saving off', () => {
  assert.equal(assistantAllowsLeadSaving(null), true);
  assert.equal(assistantAllowsLeadSaving({ applied: false, next_actions: [] }), true);
  assert.equal(assistantAllowsLeadSaving({ applied: true, next_actions: [] }), true);
  assert.equal(assistantAllowsLeadSaving({ applied: true, next_actions: ['save_lead'] }), true);
  assert.equal(assistantAllowsLeadSaving({ applied: true, next_actions: ['collect_contact'] }), false);
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
  const filled = applyProfileIdentity(sanitizeAssistant({ business_name: '', website: '' }, 'agent'), { company_name: 'RE/MAX', website: 'https://remax.example' });
  assert.equal(filled.business_name, 'RE/MAX');
  assert.equal(filled.website, 'https://remax.example');
  const kept = applyProfileIdentity(sanitizeAssistant({ business_name: 'Harbourview', website: 'https://kept.example' }, 'agent'), { company_name: 'RE/MAX', website: 'https://remax.example' });
  assert.equal(kept.business_name, 'Harbourview');
  assert.equal(kept.website, 'https://kept.example');
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
  assert.match(preview, /about the title/);
  assert.match(preview, /Do not write a second reply/);
  assert.doesNotMatch(preview, /ask one question about the agreement/);
  assert.match(preview, /Are there any title or document questions\?/);
  assert.match(preview, /Ready to act: Signed agreement and closing this month\./);

  const everything = sanitizeAssistant({
    applied: true,
    qualification_questions: ['legal_service', 'location', 'transaction_type', 'transaction_value', 'closing_date', 'urgency'],
    next_actions: ['schedule', 'save_lead'],
  }, 'lawyer');
  const publicPrompt = buildLawyerSystemPrompt(profile, { assistantSetting: everything });
  assert.match(publicPrompt, /The intake form already has the closing type, the location, the closing date/);
  assert.match(publicPrompt, /do not ask it again/);
  assert.doesNotMatch(publicPrompt, /On every later reply, ask one question about the title or the parties/);
  assert.doesNotMatch(publicPrompt, /Which jurisdiction is the property in\?/);
  assert.match(publicPrompt, /On the first reply, greet in one short sentence/);
  assert.doesNotMatch(publicPrompt, /Recap once and ask confirmation/);
  assert.match(publicPrompt, /Speak the matter the visitor named/);
  assert.match(publicPrompt, /never spoken/);
  assert.doesNotMatch(publicPrompt, /Ask ONE question at a time/);
  assert.match(publicPrompt, /Preferred next steps from the studio/);
  assert.equal(
    finishLawyerReply('I understand. Could you clarify whether this is a purchase closing or a sale closing?', {
      userMessage: 'no this is not',
      previousReply: 'Hello. Is this a purchase closing or a sale closing?',
    }),
    'I understand. What is the matter, then? A refinance closing, a title transfer, or a document review?',
  );
  assert.match(voiceTurnReminder(everything, 'no this is not'), /Do not ask that question again/);
  assert.equal(
    finishLawyerReply('Glad to help with this closing!', {
      setting: {
        personalities: ['warm-counsel'],
        formality: 'professional',
        custom_tones: [{ id: 'warm-counsel', name: 'Warm counsel', guidance: 'Warm and steady.' }],
      },
    }),
    'Glad to help with this closing!',
  );

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
    finishLawyerReply('Happy to help with this closing!', {
      setting: { personalities: ['friendly'], communication_style: 'conversational', formality: 'casual' },
    }),
    'Happy to help with this closing!',
  );
  assert.equal(
    finishLawyerReply('Happy to help with this closing!! Let us begin!', {
      preview: true,
      setting: { personalities: ['friendly'], communication_style: 'conversational' },
    }),
    'Happy to help with this closing! Let us begin.',
  );
  assert.equal(
    finishLawyerReply('Sure! I can review that agreement.', {
      preview: true,
      setting: { personalities: ['polished'], formality: 'formal' },
    }),
    'Sure. I can review that agreement.',
  );
  assert.equal(
    finishLawyerReply('Are you looking to buy or sell in these areas?', {
      userMessage: 'in which areas your are seing',
      setting: { jurisdictions: ['Ontario'] },
    }),
    'I am licensed in Ontario.',
  );
  assert.equal(
    finishLawyerReply('I understand. Could you clarify whether this is a purchase closing or a sale closing?', {
      userMessage: 'no this is not',
      previousReply: 'Hello. Is this a purchase closing or a sale closing?',
      setting: { personalities: ['friendly'], communication_style: 'conversational', formality: 'casual' },
    }),
    'Happy to help! Is it a refinance closing, a title transfer, or a document review?',
  );
  assert.equal(
    finishLawyerReply('I understand. Could you clarify whether this is a purchase closing or a sale closing?', {
      userMessage: 'no this is not',
      previousReply: 'Hello. Is this a purchase closing or a sale closing?',
      setting: { personalities: ['polished'], communication_style: 'quick', formality: 'formal' },
    }),
    'Is this a refinance closing, a title transfer, or a document review?',
  );
  assert.equal(
    finishLawyerReply('I understand. Could you clarify whether this is a purchase closing or a sale closing?', {
      userMessage: 'no this is not',
      previousReply: 'Hello. Is this a purchase closing or a sale closing?',
      setting: { personalities: ['caring'], communication_style: 'educational', formality: 'professional' },
    }),
    'A refinance, a title transfer, and a document review each use different papers. Could you tell me if this is a refinance closing, a title transfer, or a document review?',
  );
  assert.equal(
    finishLawyerReply('I understand. Could you clarify whether this is a purchase closing or a sale closing?', {
      userMessage: 'no this is not',
      previousReply: 'Hello. Is this a purchase closing or a sale closing?',
      setting: {
        personalities: ['warm-counsel'],
        communication_style: 'conversational',
        formality: 'professional',
        custom_tones: [{ id: 'warm-counsel', name: 'Warm counsel', guidance: 'Warm and steady.' }],
      },
    }),
    'I will keep this warm and steady. Is this a refinance closing, a title transfer, or a document review?',
  );
  assert.equal(
    finishLawyerReply('Are you looking to buy or sell in these areas?', {
      userMessage: 'in which areas your are seing',
      setting: {
        jurisdictions: ['Ontario'],
        personalities: ['friendly'],
        communication_style: 'conversational',
        formality: 'casual',
      },
    }),
    "Sure! I'm licensed in Ontario.",
  );
  assert.equal(
    finishLawyerReply('Are you looking to buy or sell in these areas?', {
      userMessage: 'in which areas your are seing',
      setting: {
        jurisdictions: ['Ontario'],
        personalities: ['polished'],
        communication_style: 'educational',
        formality: 'formal',
      },
    }),
    'Licensing follows the jurisdiction. I am licensed in Ontario.',
  );
  assert.equal(
    finishLawyerReply('Are you looking to buy or sell in these areas?', {
      userMessage: 'in which areas your are seing',
      setting: {
        jurisdictions: ['Ontario'],
        personalities: ['luxury'],
        communication_style: 'quick',
        formality: 'formal',
      },
    }),
    'I am licensed privately in Ontario.',
  );
  assert.equal(
    finishLawyerReply('I understand. I can review that agreement.', {
      setting: { personalities: ['friendly'], communication_style: 'conversational', formality: 'casual' },
    }),
    'Happy to help! I can review that agreement.',
  );
  assert.equal(
    finishLawyerReply('Are you looking to buy or sell a property?', {
      userMessage: 'hi',
      setting: { personalities: ['friendly'], communication_style: 'conversational', formality: 'casual' },
    }),
    'Hi, glad you are here! Happy to help with this closing. Is this a purchase closing, a sale closing, or a refinance closing?',
  );
  assert.equal(
    finishLawyerReply('I understand. Could you clarify whether this is a purchase closing or a sale closing?', {
      userMessage: 'no this is not',
      previousReply: 'Hello. Is this a purchase closing or a sale closing?',
      setting: {
        languages: ['french'],
        personalities: ['friendly'],
        communication_style: 'conversational',
        formality: 'casual',
        use_emojis: true,
      },
    }),
    'Avec plaisir! Est-ce un refinancement, un transfert de titre ou une révision de documents? 🙂',
  );
  const titleOnly = assistantSettingForPreview({
    qualification_questions: ['transaction_value'],
    personalities: ['polished'],
  }, 'lawyer');
  const titlePrompt = buildPreviewChatPrompt('lawyer', profile, { assistantSetting: titleOnly });
  assert.match(titlePrompt, /On a hello, the one question is about the title/);
  assert.doesNotMatch(titlePrompt, /On a hello, the one question is whether this is a purchase closing/);
  assert.match(voiceTurnReminder(titleOnly, 'yes', { preview: true }), /about the title/);
  const emojiVoice = { personalities: ['friendly'], communication_style: 'conversational', formality: 'casual', use_emojis: true };
  assert.equal(finishLawyerReply('Hello.', { setting: emojiVoice }), 'Hello. 👋');
  assert.equal(
    finishLawyerReply('Hello. Is this a purchase closing or a sale closing?', { setting: emojiVoice }),
    'Hello. Is this a purchase closing or a sale closing? 👋',
  );
  assert.equal(
    finishLawyerReply('Happy to help.', { setting: emojiVoice }),
    'Happy to help.',
  );
  assert.equal(
    finishLawyerReply('Happy to help! Is this a purchase closing or a sale closing?', { setting: emojiVoice }),
    'Happy to help! Is this a purchase closing or a sale closing?',
  );
  assert.equal(
    finishLawyerReply('I can review that agreement. 🏡 The closing date is next month.', { setting: emojiVoice }),
    'I can review that agreement. The closing date is next month. 🏡',
  );
  assert.equal(
    finishLawyerReply('That is wonderful news! 🎉', { setting: emojiVoice }),
    'That is wonderful news!',
  );
  assert.equal(
    finishLawyerReply('Glad the file is ready. ✨', {
      previousReply: 'The file is ready. ✨',
      setting: emojiVoice,
    }),
    'Glad the file is ready.',
  );
  assert.equal(
    finishLawyerReply('Hello.', { previousReply: 'Happy to help. 🙂', setting: emojiVoice }),
    'Hello. 👋',
  );
  assert.equal(
    finishLawyerReply('Hello.', { previousReply: 'Hello. 👋', setting: emojiVoice }),
    'Hello.',
  );
  const agentEmoji = { applied: true, role: 'agent', personalities: ['friendly'], formality: 'casual', use_emojis: true };
  assert.equal(
    finishAgentReply('Hello! Are you buying or selling?', { setting: agentEmoji }),
    'Hello! Are you buying or selling? 👋',
  );
  assert.equal(
    finishAgentReply('Wa alaikum assalam! What are you looking to buy or sell?', {
      userMessage: 'asslam o alikum',
      setting: agentEmoji,
    }),
    'Wa alaikum assalam! What are you looking to buy or sell? 👋',
  );
  assert.equal(
    finishAgentReply('I can help with that. Could you share some details about your property?', {
      userMessage: 'yes am looking to sell my home',
      setting: agentEmoji,
    }),
    'I can help with that. Could you share some details about your property? 🏡',
  );
  assert.equal(
    finishAgentReply('I found a home that fits. 🏡', { setting: agentEmoji }),
    'I found a home that fits. 🏡',
  );
  assert.equal(
    finishAgentReply('Would you like to book a call?', { setting: agentEmoji }),
    'Would you like to book a call? 📅',
  );
  assert.equal(
    finishAgentReply('What is your budget? 💰', { setting: agentEmoji }),
    'What is your budget?',
  );
  assert.equal(
    finishAgentReply('Hello! 👋', { setting: { ...agentEmoji, use_emojis: false } }),
    'Hello!',
  );
  assert.equal(
    finishBrokerReply('This document is a receipt for Cursor Pro Plus.', {
      userMessage: 'what this document contains?',
      documentReceived: true,
      setting: { personalities: ['friendly'], formality: 'casual', use_emojis: true },
    }),
    'This document is a receipt for Cursor Pro Plus. 📄',
  );
  assert.equal(
    finishBrokerReply('This document is a receipt for Cursor Pro Plus.', {
      userMessage: 'what this document contains?',
      documentReceived: true,
      previousReply: 'The file is saved. 📄',
      setting: { personalities: ['friendly'], formality: 'casual', use_emojis: true },
    }),
    'This document is a receipt for Cursor Pro Plus. ✅',
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

test('every role ships buyer, seller, and investor templates with a call to action', () => {
  for (const role of ['agent', 'mortgage_broker', 'lawyer']) {
    for (const type of ['buyer', 'seller', 'investor']) {
      const template = QUALIFICATION_TEMPLATES[role][type];
      assert.ok(template.cta_label.length > 3, `${role}/${type} needs a CTA`);
      assert.ok(template.questions.length >= 4, `${role}/${type} needs questions`);
      assert.ok(template.questions.every((question) => question.id && question.label.endsWith('?')));
    }
  }
  assert.equal(legacyPersonalityId('caring'), 'friendly');
  assert.equal(legacyPersonalityId('investor_specialist'), 'consultative');
  assert.equal(legacyPersonalityId('friendly'), 'friendly');
});

test('qualification templates keep known ids, accept custom questions, and cap the list', () => {
  const sanitized = sanitizeQualificationTemplates({
    buyer: {
      cta_label: ' Book a buyer call ',
      questions: [
        { id: 'budget', label: 'What price range feels comfortable?', enabled: true },
        { id: 'location', enabled: false },
        { label: 'Are you working with another agent?', options: ['Yes', 'No', 'Yes', 'Not sure'] },
        { id: 'nonsense', label: '' },
        ...Array.from({ length: 10 }, (_, index) => ({ label: `Extra question ${index + 1}?` })),
      ],
    },
    seller: { enabled: false },
    investor: 'not-an-object',
  }, 'agent');

  const buyer = sanitized.buyer;
  assert.equal(buyer.cta_label, 'Book a buyer call');
  assert.equal(buyer.questions.length, 8);
  assert.equal(buyer.questions[0].id, 'budget');
  assert.equal(buyer.questions[0].label, 'What price range feels comfortable?');
  assert.deepEqual(buyer.questions[0].options, QUALIFICATION_TEMPLATES.agent.buyer.questions.find((q) => q.id === 'budget').options);
  assert.equal(buyer.questions[1].id, 'location');
  assert.equal(buyer.questions[1].enabled, false);
  assert.equal(buyer.questions[1].label, QUALIFICATION_TEMPLATES.agent.buyer.questions.find((q) => q.id === 'location').label);
  const custom = buyer.questions[2];
  assert.match(custom.id, /^custom_are_you_working/);
  assert.equal(custom.custom, true);
  assert.deepEqual(custom.options, ['Yes', 'No', 'Not sure']);
  assert.equal(sanitized.seller.enabled, false);
  assert.deepEqual(sanitized.seller.questions.map((q) => q.id), QUALIFICATION_TEMPLATES.agent.seller.questions.map((q) => q.id));
  assert.ok(sanitized.seller.questions.every((q) => q.enabled === true && q.custom === false));
  assert.equal(sanitized.investor.enabled, true);
  assert.equal(sanitized.investor.cta_label, QUALIFICATION_TEMPLATES.agent.investor.cta_label);
  assert.deepEqual(sanitized.investor.questions.map((q) => q.label), QUALIFICATION_TEMPLATES.agent.investor.questions.map((q) => q.label));
});

test('client type comes from the form and selects the matching template, wording, and CTA', () => {
  assert.equal(clientTypeForForm({ client_type: 'investor', intent: 'buy' }), 'investor');
  assert.equal(clientTypeForForm({ intent: 'sell' }), 'seller');
  assert.equal(clientTypeForForm({ intent: 'buy' }), 'buyer');
  assert.equal(clientTypeForForm({ purchase_purpose: 'investment' }), 'investor');
  assert.equal(clientTypeForForm({ purchase_purpose: 'refinance' }), 'seller');
  assert.equal(clientTypeForForm({ legal_services_needed: 'sale_closing' }), 'seller');
  assert.equal(clientTypeForForm({ transaction_type: 'home_purchase' }), 'buyer');
  assert.equal(clientTypeForForm({}), '');

  const setting = sanitizeAssistant({
    applied: true,
    client_types: ['buyer', 'investor'],
    qualification_templates: {
      investor: {
        cta_label: 'Plan my next acquisition',
        questions: [
          { id: 'investment_goal', label: 'Is cash flow or appreciation the priority?', options: ['Cash flow', 'Appreciation', 'Both'] },
          { id: 'timeline', enabled: false },
          { id: 'budget' },
        ],
      },
    },
  }, 'agent');

  const investor = settingForClientType(setting, 'investor');
  assert.equal(investor.client_type, 'investor');
  assert.equal(investor.cta_label, 'Plan my next acquisition');
  assert.deepEqual(investor.qualification_questions, ['investment_goal', 'budget']);
  assert.equal(questionLabel(investor, 'investment_goal'), 'Is cash flow or appreciation the priority?');
  assert.deepEqual(questionOptions(investor, 'investment_goal'), ['Cash flow', 'Appreciation', 'Both']);

  const seller = settingForClientType(setting, 'seller');
  assert.equal(seller.client_type, undefined, 'seller is switched off in client_types so no template applies');
  assert.deepEqual(seller.qualification_questions, setting.qualification_questions);

  const prompt = buildAgentSystemPrompt(profile, { assistantSetting: investor, clientType: 'investor' });
  assert.match(prompt, /Is cash flow or appreciation the priority\?/);
  assert.match(prompt, /Plan my next acquisition/);
  assert.doesNotMatch(prompt, /When are you hoping to complete the purchase\?/);

  const broker = settingForClientType(sanitizeAssistant({ applied: true }, 'mortgage_broker'), 'investor');
  assert.equal(broker.client_type, 'investor');
  const brokerOpen = openQualificationQuestionIds(broker, {
    purchase_purpose: 'investment',
    budget: '700k_1m',
    household_income: '100k_150k',
    down_payment_readiness: '20_plus',
    mortgage_timeline: '3_6_months',
    address: 'Toronto',
  });
  assert.ok(brokerOpen.includes('investment_type'));
  assert.ok(brokerOpen.includes('owns_investments'));
  assert.equal(brokerOpen.includes('down_payment'), false);
  assert.equal(brokerOpen.includes('household_income'), false);
  assert.equal(brokerOpen.includes('property_value'), false);
  assert.equal(brokerOpen.includes('timeline'), false);

  const chips = quickRepliesForReply(investor, 'Great to meet you. Is cash flow or appreciation the priority?');
  assert.deepEqual(chips, { question_id: 'investment_goal', options: ['Cash flow', 'Appreciation', 'Both'] });
  assert.equal(quickRepliesForReply(investor, 'Great to meet you. Is cash flow or appreciation the priority?', ['investment_goal']), null);
});

test('tone level, response length, knowledge files, and lawyer preliminary-only rules reach the prompt', () => {
  const formal = sanitizeAssistant({
    applied: true,
    tone_level: 95,
    response_length: 'short',
    business_name: 'Harbourview Realty',
    website: 'https://harbourview.example',
    knowledge_files: [{ id: 'k1', name: 'Services.pdf', kind: 'services', text: 'We offer staging consultations and pricing strategy sessions.' }],
  }, 'agent');
  const prompt = appendAssistantOverlay('Role prompt', formal);
  assert.match(prompt, /Harbourview Realty/);
  assert.match(prompt, /harbourview\.example/);
  assert.match(prompt, /staging consultations/);
  assert.match(prompt, /Services\.pdf/);
  assert.equal(formal.tone_level, 95);
  assert.equal(formal.response_length, 'short');

  const clamped = sanitizeAssistant({ tone_level: 400, response_length: 'novel' }, 'agent');
  assert.equal(clamped.tone_level, 100);
  assert.equal(clamped.response_length, 'balanced');

  const lawyer = sanitizeAssistant({ applied: true }, 'lawyer');
  const lawyerPrompt = appendAssistantOverlay('Role prompt', settingForClientType(lawyer, 'buyer'));
  assert.match(lawyerPrompt, /preliminary information only/);
  assert.match(lawyerPrompt, /Schedule a Legal Consultation/);
});
