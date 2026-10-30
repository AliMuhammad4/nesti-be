import { DIFFERENTIATORS, ROLE_DIFFERENTIATORS, SERVICES, labelOf } from '../../professionalAssistant/catalog.js';
import { normalizedVisitorText } from '../../professionalAssistant/visitorMessage.js';

const EXPERIENCE_LABELS = {
  junior: 'Junior (0-2 years)',
  mid: 'Mid (3-7 years)',
  senior: 'Senior (7-15 years)',
  elite: 'Elite (15+ years)',
};

export function formatProfessionalExperience(profile, yearsExperience = 0) {
  const years = Number(yearsExperience) || Number(profile?.years_experience) || 0;
  if (Number.isFinite(years) && years > 0) {
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
  const level = String(profile?.experience_level || profile?.experience || '').trim().toLowerCase();
  if (EXPERIENCE_LABELS[level]) return EXPERIENCE_LABELS[level];
  const raw = String(profile?.experience || '').trim();
  if (raw && !EXPERIENCE_LABELS[raw.toLowerCase()]) return raw;
  return '';
}

function readableTag(value) {
  return String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function professionalExpertiseLabels(profile, setting) {
  const role = setting?.role || profile?.professional_type;
  const fromServices = (setting?.applied ? setting.services || [] : [])
    .map((id) => labelOf(SERVICES[role] || [], id))
    .filter(Boolean);
  const fromSpecialties = (setting?.applied ? setting.differentiators || [] : [])
    .filter((id) => id !== 'experience' && id !== 'other')
    .map((id) => labelOf(ROLE_DIFFERENTIATORS[role] || DIFFERENTIATORS, id))
    .filter(Boolean);
  const custom = setting?.applied
    ? (setting.custom_expertise || []).map(readableTag).filter(Boolean)
    : [];
  const hasAssistantExpertise = setting?.applied
    && (fromServices.length > 0 || fromSpecialties.length > 0 || custom.length > 0);
  const tags = hasAssistantExpertise
    ? []
    : [
        ...(profile?.specializations || []),
        ...(profile?.core_specialization_tags || []),
        ...(profile?.specialty_strength_tags || []),
      ].map(readableTag).filter(Boolean);
  const seen = new Set();
  return [...fromServices, ...fromSpecialties, ...custom, ...tags].filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function profileVisitorFactsBlock(profile, setting, yearsExperience = 0) {
  const name = String(profile?.full_name || '').trim() || 'this professional';
  const experience = formatProfessionalExperience(profile, yearsExperience);
  const expertise = professionalExpertiseLabels(profile, setting);
  const experienceLine = experience
    ? `- Experience: ${experience}. When the visitor asks about experience, years, or background, answer in the first person: "I have ${experience}." Use this saved profile fact. Do not use ${name}'s name, do not say "${name} has", do not say "years of professional experience" without this fact, and do not invent a different number.`
    : '- Experience is not saved on the profile. Do not invent years of experience. Say you can confirm that directly.';
  const expertiseLine = expertise.length
    ? `- Your services and expertise: ${expertise.join('; ')}. You are speaking as ${name}, in the first person. If the visitor asks your name, answer "My name is ${name}." and then "I help with ${expertise.join(', ')}." List every saved service and expertise item. Do not skip the name or the expertise for another question or a document request. Do not say "${name} has", "${name}'s expertise includes", or that someone else is speaking for ${name}.`
    : `- No expertise list is saved on the profile or assistant. If the visitor asks your name, answer "My name is ${name}." Do not invent specialties.`;
  return `PROFILE FACTS:\n${experienceLine}\n${expertiseLine}`;
}

export function asksForIdentity(message) {
  const text = normalizedVisitorText(message);
  return /\b(what is your name|whats your name|who are you|your name|ap ka name|apka name|aapka naam|naam kya|name kya|name kiya|tumhara naam|what do you do|about yourself|your expertise|your experience|your services|your specialties|your specialities)\b/.test(text);
}

export function identityReply({ userMessage = '', profile = null, setting = null, yearsExperience = 0 } = {}) {
  if (!asksForIdentity(userMessage)) return '';
  const name = String(profile?.full_name || setting?.display_name || '').trim();
  const expertise = professionalExpertiseLabels(profile, setting);
  const experience = formatProfessionalExperience(profile, yearsExperience);
  const parts = [];
  if (name) parts.push(`My name is ${name}.`);
  if (expertise.length) parts.push(`I help with ${expertise.join(', ')}.`);
  if (experience && /\b(experience|years|background|about yourself)\b/i.test(String(userMessage || ''))) {
    parts.push(`I have ${experience}.`);
  }
  return parts.join(' ');
}
