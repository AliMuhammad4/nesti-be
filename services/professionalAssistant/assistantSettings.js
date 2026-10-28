import {
  ASSISTANT_ROLES,
  COMMUNICATION_STYLES,
  DIFFERENTIATORS,
  ROLE_DIFFERENTIATORS,
  FORMALITIES,
  LANGUAGES,
  NEXT_ACTIONS,
  PERSONALITIES,
  DOCUMENT_REQUESTS,
  QUALIFICATION,
  ROLE_ASSISTANT_FAQS,
  SERVICES,
  VOICE_LANGUAGES,
  idsOf,
} from './catalog.js';
import { clip, faqText, freeList, list } from './assistantText.js';
import { lawyerReplyDrifted } from './lawyerReplyDrift.js';

const RETIRED_DEFAULT_ANSWERS = new Set([
  'I can collect the property location and expected closing date so the lawyer can confirm whether they can assist and explain the process.',
  'Share the property location and expected closing date; the lawyer can review the details and confirm the next steps.',
  'A lawyer may review transaction documents, address title and closing requirements, and coordinate legal steps. The exact work depends on the transaction and jurisdiction.',
  'The lawyer can confirm whether they can review the agreement and what documents are needed. Please do not share confidential documents in this chat.',
  'The lawyer can discuss title-search services for your transaction and confirm the scope based on the property and its jurisdiction.',
  'The lawyer can confirm whether they assist with refinance transactions and what information is needed for an initial discussion.',
  'Fees depend on the transaction, location, and work required. The lawyer can provide details after reviewing the relevant information.',
  'Timing depends on the transaction, documents, and jurisdiction. The lawyer can help identify key dates once they know more about your file.',
  'Tell me where the property is located and I can help the lawyer confirm whether they are authorized and available to assist there.',
  'Documents vary by transaction and jurisdiction. The lawyer can provide a tailored list after learning whether you are buying, selling, or refinancing.',
  'Share your preference and the lawyer can confirm whether a remote consultation is available for your matter.',
  'This chat is for general information and arranging contact. The lawyer can advise you after understanding your matter and confirming the appropriate engagement.',
].map((answer) => answer.toLowerCase()));

export function assistantFaqsForRole(role, savedFaqs = []) {
  const saved = Array.isArray(savedFaqs) ? savedFaqs : [];
  const defaults = (ROLE_ASSISTANT_FAQS[role] || []).map((faq) => {
    const savedFaq = saved.find((item) => item?.id === faq.id || (
      item?.is_default === true
      && item?.question?.trim().toLowerCase() === faq.question.toLowerCase()
    ));
    const savedAnswer = String(savedFaq?.answer || '').trim().toLowerCase();
    const keepSavedAnswer = savedFaq && savedAnswer
      && !RETIRED_DEFAULT_ANSWERS.has(savedAnswer)
      && !(role === 'lawyer' && lawyerReplyDrifted(savedAnswer));
    return {
      ...faq,
      ...(keepSavedAnswer ? savedFaq : {}),
      answer: keepSavedAnswer ? savedFaq.answer : faq.answer,
      id: faq.id,
      is_default: true,
      approved: true,
      source: 'manual',
    };
  });
  const customFaqs = saved
    .filter((faq) => faq?.is_default !== true)
    .map((faq, index) => ({
      id: clip(faq?.id, 120) || `${role}-custom-faq-${index + 1}`,
      question: faqText(faq?.question, 240),
      answer: faqText(faq?.answer, 1200),
      is_default: false,
      source: faq?.source === 'generated' ? 'generated' : 'manual',
      approved: faq?.source === 'generated' ? faq?.approved === true : true,
    }))
    .filter((faq) => faq.question && faq.answer)
    .slice(0, 8);
  return [...defaults, ...customFaqs];
}

export function roleForUser(user, profile) {
  const role = profile?.professional_type || user?.role;
  return ASSISTANT_ROLES.includes(role) ? role : '';
}

export function emptyAssistant(role) {
  return {
    role,
    applied: false,
    bot_name: '',
    display_name: '',
    bot_persona_title: '',
    welcome_message: '',
    signup_cta_copy: '',
    consent_line: '',
    personalities: [],
    custom_tones: [],
    languages: [],
    auto_detect_language: true,
    communication_style: 'conversational',
    formality: 'professional',
    use_emojis: false,
    address_by_first_name: true,
    suggest_consultation: true,
    services: [],
    country: '',
    region: '',
    cities: [],
    neighbourhoods: [],
    virtual_consultations: false,
    jurisdictions: [],
    differentiators: [],
    custom_expertise: [],
    unique_note: '',
    faqs: assistantFaqsForRole(role),
    services_pricing: '',
    custom_guidance: '',
    qualification_questions: idsOf(QUALIFICATION[role] || []),
    document_requests: idsOf(DOCUMENT_REQUESTS[role] || []),
    next_actions: ['schedule', 'collect_contact', 'notify', 'save_lead'],
    hot_guidance: 'Prospects who show strong intent, urgency, and readiness to take action.',
    warm_guidance: 'Prospects who are interested but need more guidance or time.',
    cold_guidance: 'Prospects who are researching or working on a longer timeline.',
  };
}

export function prefillAssistant(role, profile) {
  const draft = emptyAssistant(role);
  draft.display_name = clip(profile?.full_name, 80);
  const languages = (profile?.languages_spoken || []).filter((item) => idsOf(LANGUAGES).includes(item));
  draft.languages = languages.length ? languages : ['english'];
  draft.country = clip(profile?.country, 40);
  draft.region = clip(profile?.jurisdiction, 80);
  draft.cities = freeList(profile?.service_area_cities, 12, 80);
  draft.neighbourhoods = freeList(
    [profile?.target_neighborhoods, ...(profile?.service_area_regions || [])],
    12,
    80,
  );
  draft.jurisdictions = role === 'lawyer' && profile?.jurisdiction ? [clip(profile.jurisdiction, 80)] : [];
  draft.unique_note = clip(profile?.bio, 400);
  return draft;
}

export function sanitizeAssistant(input, role) {
  const base = emptyAssistant(role);
  const source = input && typeof input === 'object' ? input : {};
  const style = idsOf(COMMUNICATION_STYLES).includes(source.communication_style)
    ? source.communication_style
    : base.communication_style;
  const formality = FORMALITIES.includes(source.formality) ? source.formality : base.formality;
  const faqs = assistantFaqsForRole(role, source.faqs);
  const customToneIds = new Set();
  const customTones = (Array.isArray(source.custom_tones) ? source.custom_tones : [])
    .slice(0, 8)
    .map((tone) => ({
      id: clip(tone?.id, 80),
      name: clip(tone?.name, 40),
      guidance: clip(tone?.guidance, 200),
    }))
    .filter((tone) => {
      if (!tone.id || tone.name.length < 2 || tone.guidance.length < 8 || customToneIds.has(tone.id)) return false;
      customToneIds.add(tone.id);
      return true;
    });
  const validPersonalities = [...idsOf(PERSONALITIES), ...customTones.map((tone) => tone.id)];
  return {
    ...base,
    applied: source.applied === true,
    bot_name: clip(source.bot_name, 40) || base.bot_name,
    display_name: clip(source.display_name, 80),
    bot_persona_title: clip(source.bot_persona_title, 80),
    welcome_message: clip(source.welcome_message, 2000),
    signup_cta_copy: clip(source.signup_cta_copy, 400),
    consent_line: clip(source.consent_line, 400),
    personalities: list(source.personalities, validPersonalities, 2),
    custom_tones: customTones,
    languages: list(source.languages, idsOf(LANGUAGES), 20),
    auto_detect_language: source.auto_detect_language !== false,
    communication_style: style,
    formality,
    use_emojis: source.use_emojis === true,
    address_by_first_name: source.address_by_first_name !== false,
    suggest_consultation: source.suggest_consultation !== false,
    services: list(source.services, idsOf(SERVICES[role] || []), 12),
    country: clip(source.country, 40),
    region: clip(source.region, 80),
    cities: freeList(source.cities, 12, 80),
    neighbourhoods: freeList(source.neighbourhoods, 12, 80),
    virtual_consultations: source.virtual_consultations === true,
    jurisdictions: role === 'lawyer' ? freeList(source.jurisdictions, 8, 80) : [],
    differentiators: list(source.differentiators, idsOf(DIFFERENTIATORS), 9),
    custom_expertise: freeList(source.custom_expertise, 12, 100),
    unique_note: clip(source.unique_note, 400),
    faqs,
    services_pricing: clip(source.services_pricing, 800),
    custom_guidance: clip(source.custom_guidance, 2000),
    qualification_questions: list(source.qualification_questions, idsOf(QUALIFICATION[role] || []), 8),
    document_requests: Array.isArray(source.document_requests)
      ? list(source.document_requests, idsOf(DOCUMENT_REQUESTS[role] || []), 8)
      : base.document_requests,
    next_actions: Array.isArray(source.next_actions)
      ? list(source.next_actions, idsOf(NEXT_ACTIONS), 8)
      : base.next_actions,
    hot_guidance: clip(source.hot_guidance, 300) || base.hot_guidance,
    warm_guidance: clip(source.warm_guidance, 300) || base.warm_guidance,
    cold_guidance: clip(source.cold_guidance, 300) || base.cold_guidance,
  };
}

export function assistantSettingForPreview(input, role) {
  return sanitizeAssistant({ ...(input || {}), applied: true }, role);
}

export function introductionLine(_setting, profile) {
  return clip(profile?.full_name, 120) || clip(profile?.company_name, 120) || 'your professional';
}

export function assistantCatalog(role) {
  return {
    personalities: PERSONALITIES,
    communication_styles: COMMUNICATION_STYLES,
    languages: LANGUAGES,
    voice_languages: VOICE_LANGUAGES,
    differentiators: ROLE_DIFFERENTIATORS[role] || DIFFERENTIATORS,
    next_actions: NEXT_ACTIONS,
    services: SERVICES[role] || [],
    qualification: QUALIFICATION[role] || [],
    document_requests: DOCUMENT_REQUESTS[role] || [],
  };
}
