// Years of experience (0-20, 20 = "20+") is the source of truth for professionals.
// The legacy level (junior/mid/senior/elite) is derived from it so client matching,
// which reads experience_level / experience, keeps working exactly as before.

export const EXPERIENCE_YEARS_MAX = 20;

const LEGACY_LABELS = {
  junior: 'Junior (0-2 years)',
  mid: 'Mid (3-7 years)',
  senior: 'Senior (7-15 years)',
  elite: 'Elite (15+ years)',
};

// Starting point for the slider when only a legacy level was saved.
const LEGACY_LEVEL_YEARS = { junior: 1, mid: 5, senior: 10, elite: 15 };

export function normalizeExperienceYears(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(EXPERIENCE_YEARS_MAX, Math.max(0, Math.round(n)));
}

export function experienceLevelFromYears(value) {
  const years = normalizeExperienceYears(value);
  if (years === null) return '';
  if (years <= 2) return 'junior';
  if (years <= 6) return 'mid';
  if (years <= 14) return 'senior';
  return 'elite';
}

export function formatExperienceYears(value) {
  const years = normalizeExperienceYears(value);
  if (years === null) return '';
  if (years >= EXPERIENCE_YEARS_MAX) return `${EXPERIENCE_YEARS_MAX}+ years`;
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

/** Saved years, or null when the professional only has a legacy level. */
export function experienceYearsOf(profile) {
  return normalizeExperienceYears(profile?.experience_years);
}

/** Slider start value: saved years, else an estimate from the legacy level. */
export function experienceYearsEstimate(profile) {
  const saved = experienceYearsOf(profile);
  if (saved !== null) return saved;
  const level = String(profile?.experience_level || profile?.experience || '').trim().toLowerCase();
  return Object.hasOwn(LEGACY_LEVEL_YEARS, level) ? LEGACY_LEVEL_YEARS[level] : null;
}

/** Human text for every display surface: "12 years", "20+ years", or the legacy label. */
export function experienceLabel(profile) {
  const years = experienceYearsEstimate(profile);
  if (years !== null) return formatExperienceYears(years);
  const level = String(profile?.experience_level || '').trim().toLowerCase();
  if (LEGACY_LABELS[level]) return LEGACY_LABELS[level];
  const raw = String(profile?.experience || '').trim();
  return LEGACY_LABELS[raw.toLowerCase()] || raw;
}
