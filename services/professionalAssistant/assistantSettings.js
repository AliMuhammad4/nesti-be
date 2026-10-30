import {
  ASSISTANT_ROLES,
  CLIENT_TYPES,
  COMMUNICATION_STYLES,
  DEFAULT_BRAND_COLORS,
  DIFFERENTIATORS,
  ROLE_DIFFERENTIATORS,
  FORMALITIES,
  LANGUAGES,
  NEXT_ACTIONS,
  PERSONALITIES,
  DOCUMENT_REQUESTS,
  INTAKE_QUESTION_IDS,
  QUALIFICATION,
  QUALIFICATION_TEMPLATES,
  RESPONSE_LENGTHS,
  ROLE_ASSISTANT_FAQS,
  SERVICES,
  VOICE_LANGUAGES,
  idsOf,
  legacyPersonalityId,
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

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_TEMPLATE_QUESTIONS = 8;
const MAX_QUESTION_OPTIONS = 8;
const MAX_KNOWLEDGE_FILES = 6;
const MAX_KNOWLEDGE_TEXT = 6000;

export function brandColor(value, fallback) {
  const text = String(value || '').trim();
  if (!HEX_COLOR.test(text)) return fallback;
  return text.length === 7 ? text.toUpperCase() : fallback;
}

export function defaultQualificationTemplates(role) {
  const roleTemplates = QUALIFICATION_TEMPLATES[role] || {};
  return Object.fromEntries(idsOf(CLIENT_TYPES).map((type) => {
    const base = roleTemplates[type] || { cta_label: '', questions: [] };
    return [type, {
      enabled: true,
      cta_label: base.cta_label,
      questions: base.questions.map((question) => ({
        id: question.id,
        label: question.label,
        enabled: true,
        options: [...question.options],
        custom: false,
      })),
    }];
  }));
}

function slugId(text, index) {
  const slug = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return slug ? `custom_${slug}` : `custom_question_${index + 1}`;
}

export function sanitizeQualificationTemplates(input, role) {
  const defaults = defaultQualificationTemplates(role);
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.fromEntries(idsOf(CLIENT_TYPES).map((type) => {
    const base = defaults[type];
    const raw = source[type];
    if (!raw || typeof raw !== 'object') return [type, base];
    const baseById = new Map(base.questions.map((question) => [question.id, question]));
    const seen = new Set();
    const questions = (Array.isArray(raw.questions) ? raw.questions : [])
      .map((question, index) => {
        const requestedId = clip(question?.id, 60);
        const known = baseById.get(requestedId);
        const label = clip(question?.label, 200) || known?.label || '';
        const id = known ? known.id : (requestedId && /^custom_[a-z0-9_]+$/.test(requestedId) ? requestedId : slugId(label, index));
        const options = freeList(question?.options, MAX_QUESTION_OPTIONS, 60);
        return {
          id,
          label,
          enabled: question?.enabled !== false,
          options: known && !Array.isArray(question?.options) ? [...known.options] : options,
          custom: !known,
        };
      })
      .filter((question) => {
        if (!question.label || seen.has(question.id)) return false;
        seen.add(question.id);
        return true;
      })
      .slice(0, MAX_TEMPLATE_QUESTIONS);
    return [type, {
      enabled: raw.enabled !== false,
      cta_label: clip(raw.cta_label, 60) || base.cta_label,
      questions: questions.length ? questions : base.questions,
    }];
  }));
}

export function sanitizeKnowledgeFiles(input) {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  return source
    .map((file) => ({
      id: clip(file?.id, 80),
      name: clip(file?.name, 120),
      kind: ['bio', 'services', 'faqs', 'marketing', 'other'].includes(file?.kind) ? file.kind : 'other',
      text: String(file?.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_KNOWLEDGE_TEXT),
      uploaded_at: file?.uploaded_at ? new Date(file.uploaded_at) : new Date(),
    }))
    .filter((file) => {
      if (!file.id || !file.name || !file.text || seen.has(file.id)) return false;
      seen.add(file.id);
      return true;
    })
    .slice(0, MAX_KNOWLEDGE_FILES);
}

export function emptyAssistant(role) {
  return {
    role,
    applied: false,
    confirmed_sections: [],
    bot_name: '',
    display_name: '',
    business_name: '',
    website: '',
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
    tone_level: 50,
    response_length: 'balanced',
    use_emojis: false,
    address_by_first_name: true,
    suggest_consultation: true,
    brand_colors: { ...DEFAULT_BRAND_COLORS },
    logo_url: '',
    avatar_url: '',
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
    knowledge_files: [],
    services_pricing: '',
    custom_guidance: '',
    client_types: idsOf(CLIENT_TYPES),
    qualification_templates: defaultQualificationTemplates(role),
    qualification_questions: idsOf(QUALIFICATION[role] || []),
    document_requests: idsOf(DOCUMENT_REQUESTS[role] || []),
    next_actions: ['schedule', 'collect_contact', 'notify', 'save_lead'],
    hot_guidance: 'Prospects who show strong intent, urgency, and readiness to take action.',
    warm_guidance: 'Prospects who are interested but need more guidance or time.',
    cold_guidance: 'Prospects who are researching or working on a longer timeline.',
  };
}

export function applyProfileIdentity(draft, profile) {
  if (!draft || !profile) return draft;
  if (!String(draft.business_name || '').trim()) draft.business_name = clip(profile.company_name, 120);
  if (!String(draft.website || '').trim()) draft.website = clip(profile.website, 200);
  return draft;
}

export function prefillAssistant(role, profile) {
  const draft = emptyAssistant(role);
  draft.display_name = clip(profile?.full_name, 80);
  applyProfileIdentity(draft, profile);
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
  const personalities = list(
    (Array.isArray(source.personalities) ? source.personalities : []).map((id) => legacyPersonalityId(id)),
    validPersonalities,
    2,
  );
  const toneLevel = Number(source.tone_level);
  const responseLength = idsOf(RESPONSE_LENGTHS).includes(source.response_length)
    ? source.response_length
    : base.response_length;
  const sourceColors = source.brand_colors && typeof source.brand_colors === 'object' ? source.brand_colors : {};
  const requestedClientTypes = Array.isArray(source.client_types)
    ? list(source.client_types, idsOf(CLIENT_TYPES), 3)
    : base.client_types;
  const setupSections = ['business', 'personality', 'tone', 'branding', 'services', 'area', 'clients', 'languages', 'knowledge', 'handoff', 'share'];
  const confirmedSections = [...new Set((Array.isArray(source.confirmed_sections) ? source.confirmed_sections : [])
    .map((id) => String(id || '').trim())
    .filter((id) => setupSections.includes(id)))];
  return {
    ...base,
    applied: source.applied === true,
    confirmed_sections: confirmedSections,
    bot_name: clip(source.bot_name, 40) || base.bot_name,
    display_name: clip(source.display_name, 80),
    business_name: clip(source.business_name, 120),
    website: clip(source.website, 200),
    bot_persona_title: clip(source.bot_persona_title, 80),
    welcome_message: clip(source.welcome_message, 2000),
    signup_cta_copy: clip(source.signup_cta_copy, 400),
    consent_line: clip(source.consent_line, 400),
    personalities,
    custom_tones: customTones,
    languages: list(source.languages, idsOf(LANGUAGES), 20),
    auto_detect_language: source.auto_detect_language !== false,
    communication_style: style,
    formality,
    tone_level: Number.isFinite(toneLevel) ? Math.min(100, Math.max(0, Math.round(toneLevel))) : base.tone_level,
    response_length: responseLength,
    use_emojis: source.use_emojis === true,
    address_by_first_name: source.address_by_first_name !== false,
    suggest_consultation: source.suggest_consultation !== false,
    brand_colors: {
      primary: brandColor(sourceColors.primary, DEFAULT_BRAND_COLORS.primary),
      accent: brandColor(sourceColors.accent, DEFAULT_BRAND_COLORS.accent),
    },
    logo_url: clip(source.logo_url, 500),
    avatar_url: clip(source.avatar_url, 500),
    knowledge_files: sanitizeKnowledgeFiles(source.knowledge_files),
    client_types: requestedClientTypes.length ? requestedClientTypes : base.client_types,
    qualification_templates: sanitizeQualificationTemplates(source.qualification_templates, role),
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
    response_lengths: RESPONSE_LENGTHS,
    languages: LANGUAGES,
    voice_languages: VOICE_LANGUAGES,
    differentiators: ROLE_DIFFERENTIATORS[role] || DIFFERENTIATORS,
    next_actions: NEXT_ACTIONS,
    services: SERVICES[role] || [],
    qualification: QUALIFICATION[role] || [],
    client_types: CLIENT_TYPES,
    qualification_templates: defaultQualificationTemplates(role),
    document_requests: DOCUMENT_REQUESTS[role] || [],
    intake_question_ids: INTAKE_QUESTION_IDS[role] || [],
    default_brand_colors: DEFAULT_BRAND_COLORS,
  };
}

export function clientTypeForForm(form) {
  if (!form || typeof form !== 'object') return '';
  const explicit = String(form.client_type || '').trim().toLowerCase();
  if (idsOf(CLIENT_TYPES).includes(explicit)) return explicit;
  const purpose = String(form.purchase_purpose || form.purpose || form.motivation_reason || '').toLowerCase();
  if (purpose === 'investment' || purpose.includes('invest')) return 'investor';
  if (form.intent === 'sell') return 'seller';
  if (form.intent === 'buy') return 'buyer';
  const legal = String(form.legal_services_needed || form.transaction_type || '').toLowerCase();
  if (/sale|sell/.test(legal)) return 'seller';
  if (/purchase|buy/.test(legal)) return 'buyer';
  if (purpose === 'refinance' || purpose === 'renewal' || purpose === 'home_sale') return 'seller';
  if (purpose === 'home_purchase' || purpose === 'primary_residence' || purpose === 'vacation_home') return 'buyer';
  return '';
}

export function activeQualificationTemplate(setting, clientType) {
  if (!setting?.applied) return null;
  const type = idsOf(CLIENT_TYPES).includes(clientType) ? clientType : '';
  if (!type) return null;
  if (Array.isArray(setting.client_types) && setting.client_types.length && !setting.client_types.includes(type)) return null;
  const tpl = setting.qualification_templates?.[type];
  if (!tpl || tpl.enabled === false) return null;
  const questions = (tpl.questions || []).filter((question) => question.enabled !== false && question.label);
  if (!questions.length) return null;
  return { client_type: type, cta_label: tpl.cta_label || '', questions };
}

/**
 * Returns the setting with `qualification_questions` swapped for the active client-type template,
 * plus `question_overrides` (id -> { label, options }), `client_type`, and `cta_label`.
 * Everything downstream that reads `qualification_questions` keeps working unchanged.
 */
export function settingForClientType(setting, clientType) {
  const template = activeQualificationTemplate(setting, clientType);
  if (!template) return setting;
  return {
    ...setting,
    client_type: template.client_type,
    cta_label: template.cta_label,
    qualification_questions: template.questions.map((question) => question.id),
    question_overrides: Object.fromEntries(template.questions.map((question) => [
      question.id,
      { label: question.label, options: question.options || [] },
    ])),
  };
}

export function questionLabel(setting, id) {
  const override = setting?.question_overrides?.[id];
  if (override?.label) return override.label;
  const row = (QUALIFICATION[setting?.role] || []).find(([value]) => value === id);
  if (row) return row[1];
  const types = QUALIFICATION_TEMPLATES[setting?.role] || {};
  for (const type of Object.values(types)) {
    const hit = type.questions.find((question) => question.id === id);
    if (hit) return hit.label;
  }
  return '';
}

export function questionOptions(setting, id) {
  const override = setting?.question_overrides?.[id];
  return Array.isArray(override?.options) ? override.options : [];
}

export function qualificationQuestionsFor(setting, clientType) {
  const template = activeQualificationTemplate(setting, clientType);
  if (template) return template.questions.map(({ id, label, options }) => ({ id, label, options: options || [] }));
  return (setting?.qualification_questions || [])
    .map((id) => {
      const row = (QUALIFICATION[setting?.role] || []).find(([value]) => value === id);
      return row ? { id, label: row[1], options: [] } : null;
    })
    .filter(Boolean);
}
