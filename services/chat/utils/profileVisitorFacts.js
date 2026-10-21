import { DIFFERENTIATORS, SERVICES, labelOf } from '../../professionalAssistant/catalog.js';

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
    .map((id) => labelOf(DIFFERENTIATORS, id))
    .filter(Boolean);
  const custom = setting?.applied
    ? (setting.custom_expertise || []).map(readableTag).filter(Boolean)
    : [];
  const tags = [
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
    ? `- Experience: ${experience}. When the visitor asks about experience, years, or background, say ${name} has ${experience}. Use this saved profile fact. Do not say "years of professional experience" without this fact, and do not invent a different number.`
    : '- Experience is not saved on the profile. Do not invent years of experience. Say the professional can confirm that directly.';
  const expertiseLine = expertise.length
    ? `- Expertise: ${expertise.join('; ')}. When you introduce ${name}, or when the visitor asks about experience, services, strengths, or what ${name} does, show this expertise as a short bullet list so the visitor can see it. Do not hide it inside a vague paragraph.`
    : '- No expertise list is saved on the profile or assistant. Do not invent specialties.';
  return `PROFILE FACTS:\n${experienceLine}\n${expertiseLine}`;
}
