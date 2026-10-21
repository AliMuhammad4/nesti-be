import { randomUUID } from 'node:crypto';
import ProfessionalAssistantSetting from '../../models/ProfessionalAssistantSetting.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import {
  ASSISTANT_ROLES,
  COMMUNICATION_STYLES,
  DIFFERENTIATORS,
  FORMALITIES,
  LANGUAGES,
  NEXT_ACTIONS,
  PERSONALITIES,
  QUALIFICATION,
  ROLE_ASSISTANT_FAQS,
  SERVICES,
  VOICE_LANGUAGES,
  idsOf,
  labelOf,
} from './catalog.js';

const clip = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const faqText = (value, max) => String(value || '').trim().slice(0, max);
const list = (value, allowed, max) => {
  const source = Array.isArray(value) ? value : [];
  const kept = [];
  source.forEach((item) => {
    const id = clip(item, 80);
    if (!id || !allowed.includes(id) || kept.includes(id) || kept.length >= max) return;
    kept.push(id);
  });
  return kept;
};
const freeList = (value, max, itemMax) => {
  const source = Array.isArray(value) ? value : [];
  const kept = [];
  source.forEach((item) => {
    const text = clip(item, itemMax);
    if (!text || kept.some((entry) => entry.toLowerCase() === text.toLowerCase()) || kept.length >= max) return;
    kept.push(text);
  });
  return kept;
};

export function assistantFaqsForRole(role, savedFaqs = []) {
  const saved = Array.isArray(savedFaqs) ? savedFaqs : [];
  const defaults = (ROLE_ASSISTANT_FAQS[role] || []).map((faq) => {
    const savedFaq = saved.find((item) => item?.id === faq.id || (
      item?.is_default === true
      && item?.question?.trim().toLowerCase() === faq.question.toLowerCase()
    ));
    return {
      ...faq,
      ...(savedFaq || {}),
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
    website_import_url: '',
    faq_upload_note: '',
    qualification_questions: idsOf(QUALIFICATION[role] || []),
    next_actions: ['schedule', 'collect_contact', 'notify', 'save_lead'],
    hot_guidance: 'Prospects who show strong intent, urgency, and readiness to take action.',
    warm_guidance: 'Prospects who are interested but need more guidance or time.',
    cold_guidance: 'Prospects who are researching or working on a longer timeline.',
    voice_accent: '',
    transfer_calls: false,
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
  draft.website_import_url = clip(profile?.website, 300);
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
    website_import_url: clip(source.website_import_url, 300),
    faq_upload_note: clip(source.faq_upload_note, 400),
    qualification_questions: list(source.qualification_questions, idsOf(QUALIFICATION[role] || []), 8),
    next_actions: list(source.next_actions, idsOf(NEXT_ACTIONS), 8),
    hot_guidance: clip(source.hot_guidance, 300) || base.hot_guidance,
    warm_guidance: clip(source.warm_guidance, 300) || base.warm_guidance,
    cold_guidance: clip(source.cold_guidance, 300) || base.cold_guidance,
    voice_accent: clip(source.voice_accent, 80),
    transfer_calls: source.transfer_calls === true,
  };
}

const FORMALITY_DIRECTIVES = {
  formal: 'Use formal language. No slang, no contractions, and no casual asides.',
  professional: 'Use clear professional language. Polite and plain, neither stiff nor slangy.',
  casual: 'Use casual everyday language. Contractions are fine. Do not sound corporate.',
};

export function formalityInstruction(setting) {
  const key = setting?.formality;
  const directive = FORMALITY_DIRECTIVES[key];
  return directive ? `Reply formality: ${key}. ${directive}` : '';
}

export function voiceInstruction(setting) {
  const voices = (setting?.personalities || []).map((id) => {
    const custom = (setting?.custom_tones || []).find((tone) => tone.id === id);
    if (custom?.name) return custom.guidance ? `${custom.name}: ${custom.guidance}` : custom.name;
    const row = PERSONALITIES.find(([value]) => value === id);
    return row ? `${row[1]} — ${row[2]}` : '';
  }).filter(Boolean);
  return voices.join('; ');
}

export function communicationInstruction(setting) {
  const style = COMMUNICATION_STYLES.find(([id]) => id === setting?.communication_style);
  return style ? `${style[1]}. ${style[2]}` : '';
}

export function appliedPersonaText(setting) {
  const voices = voiceInstruction(setting);
  const style = communicationInstruction(setting);
  const formality = formalityInstruction(setting);
  const roleLimit = setting?.role === 'lawyer'
    ? '\n- You never give legal advice; you qualify leads and suggest they speak with the lawyer for personalized guidance.'
    : setting?.role === 'mortgage_broker'
      ? '\n- Do not promise rates, approval, or lender decisions.'
      : '';
  return `OVERALL PERSONA:
- ${voices ? `Speak in this voice: ${voices}.` : 'Speak in a clear, professional voice.'}
- ${style ? `Communication style: ${style} This sets reply length and detail.` : 'Keep replies clear and professional.'}
- ${formality || 'Reply formality: professional. Use clear professional language. Polite and plain, neither stiff nor slangy.'}
- Acknowledge the visitor's feelings briefly, then give the next practical step.
- Do not fall back to a generic calm, warm, or concise persona when it conflicts with this voice or style.${roleLimit}`;
}

export function appliedQualificationBlock(setting) {
  const labels = (setting?.qualification_questions || [])
    .map((id) => labelOf(QUALIFICATION[setting?.role] || [], id))
    .filter(Boolean);
  if (!labels.length) {
    return `SELECTED QUALIFICATION QUESTIONS:
- No extra qualification questions are turned on. Do not walk the older default list.`;
  }
  return `SELECTED QUALIFICATION QUESTIONS (ask only these, one at a time, and skip any the client already answered):
${labels.map((question, index) => `${index + 1}. "${question}"`).join('\n')}`;
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
    differentiators: DIFFERENTIATORS,
    next_actions: NEXT_ACTIONS,
    services: SERVICES[role] || [],
    qualification: QUALIFICATION[role] || [],
  };
}

function hasServiceArea(setting) {
  return Boolean(setting?.country || setting?.region || setting?.cities?.length || setting?.neighbourhoods?.length || setting?.jurisdictions?.length);
}

export function appendAssistantOverlay(prompt, setting) {
  if (!setting?.applied) return prompt;
  const lines = [
    'Professional-approved assistant settings for this account only. Ignore every homepage and admin chatbot setting.',
  ];
  if (setting.bot_name) {
    lines.push(`Your spoken assistant name is "${setting.bot_name}". Use it when introducing yourself; do not present it as the professional's name.`);
  }
  if (setting.signup_cta_copy) {
    lines.push(`When account creation is a relevant next step and the visitor has expressed interest, use this signup invitation exactly as written: "${setting.signup_cta_copy}". Do not repeat it or imply an account was created.`);
  }
  if (setting.consent_line) {
    lines.push(`Before asking for contact details, provide this consent explanation: "${setting.consent_line}". Do not imply consent has been given until the visitor agrees.`);
  }
  if (setting.introduction_line) {
    lines.push(`Introduce this professional as "${setting.introduction_line}".`);
  }
  const voice = voiceInstruction(setting);
  if (voice) {
    lines.push(`Blend this voice: ${voice}. This voice overrides a generic warm, calm, or concise style. Keep every fact accurate.`);
  }
  const style = communicationInstruction(setting);
  if (style) {
    lines.push(`Communication style: ${style} This sets reply length and detail, and it overrides any instruction that every reply must be short or warm.`);
  }
  const formality = formalityInstruction(setting);
  if (formality) lines.push(formality);
  if (setting.languages?.length) {
    const names = setting.languages.map((id) => labelOf(LANGUAGES, id)).filter(Boolean);
    lines.push(`Chat languages: ${names.join(', ')}.${setting.auto_detect_language ? ' Detect the client language and answer in it when you can.' : ''}`);
  }
  lines.push(setting.use_emojis
    ? 'Emojis are allowed in chat replies only. Never use emojis in a spoken or voice reply.'
    : 'Do not use emojis.');
  lines.push(setting.address_by_first_name
    ? 'Address the client by first name after you know it.'
    : 'Do not address the client by first name.');
  lines.push(setting.suggest_consultation
    ? 'You may suggest a consultation when the client shows interest.'
    : 'Do not suggest a consultation unless the client asks.');
  if (setting.services?.length) {
    const names = setting.services.map((id) => labelOf(SERVICES[setting.role] || [], id)).filter(Boolean);
    if (names.length) lines.push(`Specializations to use when answering: ${names.join(', ')}.`);
  }
  if (hasServiceArea(setting)) {
    const place = [setting.cities?.join(', '), setting.neighbourhoods?.join(', '), setting.region, setting.country].filter(Boolean).join('; ');
    const licensed = setting.jurisdictions?.length ? ` Licensed jurisdictions: ${setting.jurisdictions.join(', ')}.` : '';
    lines.push(`Service area: ${place || 'the saved area'}.${licensed} If an inquiry is outside this area, say so and still offer to take their details. This replaces any instruction that you can help in any city.`);
  }
  if (setting.virtual_consultations) lines.push('Virtual consultations are available, including for visitors outside the saved physical service area.');
  const claims = (setting.differentiators || [])
    .filter((id) => id !== 'experience')
    .map((id) => labelOf(DIFFERENTIATORS, id))
    .filter(Boolean);
  if (claims.length || setting.unique_note) {
    lines.push(`Approved claims only: ${[...claims, setting.unique_note].filter(Boolean).join('. ')}. Do not invent other business claims.`);
  }
  if (setting.custom_expertise?.length) {
    lines.push(`Professional-approved custom expertise: ${setting.custom_expertise.join('; ')}. Include these when you show expertise.`);
  }
  const faqs = (setting.faqs || []).filter((faq) => (
    faq.approved && faq.question && faq.answer
    && !(setting.role === 'agent' && /find a property/i.test(faq.question))
  ));
  if (faqs.length) {
    lines.push(`Approved answers. Use one only when the client asked that question. Do not use an FAQ to replace a property-card reply or a seller property question: ${JSON.stringify(faqs.map(({ question, answer }) => ({ question, answer })))}`);
  }
  if (setting.services_pricing) lines.push(`Approved service notes: ${setting.services_pricing}`);
  if (setting.custom_guidance) lines.push(`Professional instructions: ${setting.custom_guidance}. Follow them for emphasis only. Do not break safety, consent, or role limits.`);
  const actions = setting.next_actions || [];
  lines.push(`CUSTOMIZATION PRIORITY — assistant style: The selected voice, communication style, formality, and language preferences above override conflicting general persona or style instructions elsewhere in this prompt. Keep role-specific safety and accuracy requirements.`);
  if (!actions.includes('collect_contact')) {
    lines.push('CUSTOMIZATION PRIORITY — contact details: Do not ask for or prompt the visitor to provide contact details. You may accept details the visitor volunteers, but do not solicit them.');
  }
  if (!actions.includes('save_lead')) {
    lines.push('CUSTOMIZATION PRIORITY — CRM: Do not create or update a CRM lead, and do not claim that visitor details will be saved or followed up.');
  }
  if (!actions.includes('schedule')) {
    lines.push('Do not offer a booking link unless the client asks to schedule.');
  }
  if (actions.includes('callback')) lines.push('You may offer a callback. Do not say it is already booked.');
  if (actions.includes('follow_up')) lines.push('You may say the professional can follow up. Do not promise a message that has not been approved.');
  if (actions.includes('transfer_call')) lines.push('A live call transfer is a saved preference only. Do not say the call is being transferred.');
  if (setting.role === 'agent') {
    lines.push('Buyer and seller handling stays in force. The intake form already collects intent, location, budget, timeline, property type, and mortgage status, so do not treat those as customization questions. For a buyer, property matches appear only as chat cards. When they ask to see options, reply with one short sentence that points at the cards. Do not list homes, prices, or features. An FAQ cannot replace that reply. For a seller, do not offer property match cards. Ask about the property they are selling, not about a home they want to buy.');
  }
  if (setting.hot_guidance || setting.warm_guidance || setting.cold_guidance) {
    lines.push(`Next-step guidance, which does not change the lead score: Hot — ${setting.hot_guidance} Warm — ${setting.warm_guidance} Cold — ${setting.cold_guidance}`);
  }
  return `${prompt}\n\n${lines.join('\n')}`;
}

export function assistantAllowsLeadSaving(setting) {
  return !setting?.applied || (setting.next_actions || []).includes('save_lead');
}

export function appliedSettingForRole(setting, role) {
  if (!setting?.applied) return null;
  if (setting.role && role && setting.role !== role) return null;
  return setting;
}

export async function loadAppliedAssistantSetting(userId) {
  if (!userId) return null;
  const doc = await ProfessionalAssistantSetting.findOne({ user_id: userId, applied: true }).lean();
  if (!doc) return null;
  const profile = await ProfessionalProfile.findOne({ user_id: userId }).select('full_name company_name professional_type').lean();
  if (!appliedSettingForRole(doc, profile?.professional_type)) return null;
  return { ...doc, introduction_line: introductionLine(doc, profile) };
}

export async function assistantAllowsLeadEmail(userId) {
  const doc = await ProfessionalAssistantSetting.findOne({ user_id: userId, applied: true }).select('next_actions').lean();
  if (!doc) return true;
  return (doc.next_actions || []).includes('notify');
}

export function draftFaqs(setting, profile) {
  const role = setting?.role;
  const name = clip(profile?.full_name, 120) || 'This professional';
  const customFaqCount = (setting?.faqs || []).filter((faq) => faq?.is_default !== true).length;
  const availableSlots = Math.max(0, 8 - customFaqCount);
  if (!availableSlots) return [];
  const services = (setting?.services || [])
    .map((id) => labelOf(SERVICES[role] || [], id) || id);
  const expertise = freeList(setting?.custom_expertise, 12, 100);
  const fallbackServices = services.length || expertise.length
    ? []
    : idsOf(SERVICES[role] || []).slice(0, 3).map((id) => labelOf(SERVICES[role] || [], id) || id);
  const area = setting?.cities?.[0] || setting?.region || profile?.location || '';
  return [...services, ...expertise, ...fallbackServices].slice(0, Math.min(5, availableSlots)).map((label) => {
    return {
      question: `Can you help with ${label.toLowerCase()}?`,
      answer: `${name} helps clients with ${label.toLowerCase()}${area ? ` in ${area}` : ''}.${setting?.unique_note ? ` ${setting.unique_note}` : ''}`,
      id: `${role}-suggested-${randomUUID()}`,
      approved: false,
      source: 'generated',
    };
  });
}

export async function readAssistantForUser(user) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id }).lean();
  const role = roleForUser(user, profile);
  if (!role) return null;
  const saved = await ProfessionalAssistantSetting.findOne({ user_id: user._id }).lean();
  const draft = saved ? sanitizeAssistant(saved, role) : prefillAssistant(role, profile);
  draft.display_name = draft.display_name || clip(profile?.full_name, 80);
  draft.applied = Boolean(saved?.applied);
  return {
    saved: Boolean(saved),
    applied: Boolean(saved?.applied),
    role,
    draft,
    catalog: assistantCatalog(role),
    voice_note: 'Voice replies currently speak English only. Other selected languages are used in chat.',
  };
}

export async function saveAssistantForUser(user, body) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id }).lean();
  const role = roleForUser(user, profile);
  if (!role) return null;
  const next = sanitizeAssistant({ ...body, role }, role);
  const doc = await ProfessionalAssistantSetting.findOneAndUpdate(
    { user_id: user._id },
    {
      $set: { ...next, user_id: user._id, role },
      $unset: {
        introduction_mode: '',
        introduction_custom: '',
        professional_title: '',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, strict: false },
  ).lean();
  return sanitizeAssistant(doc, role);
}
