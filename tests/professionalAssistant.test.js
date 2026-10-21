import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAssistantOverlay,
  appliedSettingForRole,
  assistantFaqsForRole,
  assistantAllowsLeadSaving,
  draftFaqs,
  introductionLine,
  prefillAssistant,
  sanitizeAssistant,
} from '../services/professionalAssistant/professionalAssistantService.js';
import { PERSONALITIES } from '../services/professionalAssistant/catalog.js';
import { buildAgentSystemPrompt } from '../services/chat/prompts/agentPrompt.js';
import { buildLawyerSystemPrompt } from '../services/chat/prompts/lawyerPrompt.js';
import { buildMortgageBrokerSystemPrompt } from '../services/chat/prompts/mortgageBrokerPrompt.js';

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
  assert.match(withYears, /waterfront homes/);
  assert.match(withYears, /show this expertise as a short bullet list/);
  assert.doesNotMatch(withYears, /Approved claims only: Years of professional experience/);

  const fromLevel = buildAgentSystemPrompt(experienced, {});
  assert.match(fromLevel, /Experience: Senior \(7-15 years\)/);
  assert.match(fromLevel, /waterfront homes/);

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
  assert.doesNotMatch(prompt, /include the Calendly Markdown link/);
  assert.match(prompt, /one short sentence that points at the cards/);
  assert.doesNotMatch(prompt, /selected qualification/);
  assert.match(prompt, /An FAQ cannot replace that reply/);
  assert.match(prompt, /keep it short/);
  assert.match(prompt, /Do not repeat this recap on later turns/);
  assert.match(prompt, /Prioritise the most impactful questions first/);
  assert.match(prompt, /Bedrooms and bathrooms needed/);
  assert.match(prompt, /must-have features like a pool or garage/);
  assert.doesNotMatch(prompt, /find a property/i);
  assert.match(prompt, /Do not steer the visitor toward scheduling unless they ask/);
  assert.match(prompt, /Professional-approved assistant settings/);
  assert.match(prompt, /Sarah Johnson/);
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
  assert.match(lawyer, /Professional and polished/);
  assert.match(lawyer, /Detailed and educational/);
  assert.match(lawyer, /The lawyer intake form already collected/);
  assert.doesNotMatch(lawyer, /What is your expected closing date/);
  assert.doesNotMatch(lawyer, /Calm, professional, reassuring/);
  assert.doesNotMatch(lawyer, /Are you working with a realtor/);
  assert.doesNotMatch(lawyer, /include one booking link in the same reply/);
  assert.match(lawyer, /Do not offer a booking link/);

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
  assert.doesNotMatch(broker, /include one booking link in the same reply/);
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
  assert.equal(draft.website_import_url, 'https://example.com');
  const faqs = draftFaqs({ ...draft, role: 'lawyer', services: ['purchase_closing'] }, profile);
  assert.equal(faqs[0].approved, false);
  assert.match(faqs[0].question, /purchase closings/i);
  assert.equal(appendAssistantOverlay('Role prompt', draft), 'Role prompt');
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
    assert.match(prompt, /Reply formality: casual/);
    assert.match(prompt, /Do not ask those questions again/);
    assert.doesNotMatch(prompt, /CUSTOMIZATION PRIORITY — qualification questions/);
    assert.match(prompt, /Do not ask for or prompt the visitor to provide contact details/);
    assert.doesNotMatch(prompt, /CUSTOMIZATION PRIORITY — CRM: Do not create or update/);
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

test('CRM lead saving follows the applied assistant next-action setting', () => {
  assert.equal(assistantAllowsLeadSaving(null), true);
  assert.equal(assistantAllowsLeadSaving({ applied: false, next_actions: [] }), true);
  assert.equal(assistantAllowsLeadSaving({ applied: true, next_actions: ['collect_contact'] }), false);
  assert.equal(assistantAllowsLeadSaving({ applied: true, next_actions: ['save_lead'] }), true);
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
  assert.match(appendAssistantOverlay('Role prompt', setting), /Create an account to continue/);
  assert.match(appendAssistantOverlay('Role prompt', setting), /May I use your details to follow up/);
  assert.equal(prefillAssistant('agent', profile).display_name, 'Sarah Johnson');
});

test('each professional role receives 12 default FAQs and can save at most 8 custom FAQs', () => {
  for (const role of ['agent', 'mortgage_broker', 'lawyer']) {
    const defaults = assistantFaqsForRole(role);
    assert.equal(defaults.length, 12);
    assert.ok(defaults.every((faq) => faq.is_default && faq.approved && faq.question && faq.answer));
    assert.equal(new Set(defaults.map((faq) => faq.id)).size, 12);
  }

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
