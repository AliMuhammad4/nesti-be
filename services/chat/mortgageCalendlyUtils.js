/**
 * Mortgage broker: tier-specific Calendly URLs on ProfessionalProfile fall back to `calendly_link`.
 */

const TIER_FIELDS = {
  hot:   'mortgage_calendly_link_hot',
  warm:  'mortgage_calendly_link_warm',
  early: 'mortgage_calendly_link_early',
};

export function tierKeyForMortgageGrade(grade) {
  if (grade === 'hot') return 'hot';
  if (grade === 'warm') return 'warm';
  return 'early';
}
export function resolveMortgageCalendlyUrl(profile, leadGrade) {
  if (!profile) return '';
  const tier = tierKeyForMortgageGrade(leadGrade || 'cold');
  const specific = (profile[TIER_FIELDS[tier]] || '').trim();
  const fallback = (profile.calendly_link || '').trim();
  return specific || fallback;
}
export function hasMortgageCalendlyConfigured(profile) {
  if (!profile) return false;
  if ((profile.calendly_link || '').trim()) return true;
  return Object.values(TIER_FIELDS).some((k) => (profile[k] || '').trim());
}
export function primaryCalendlyLinkForAlignment(profile) {
  if (!profile) return '';
  const main = (profile.calendly_link || '').trim();
  if (main) return main;
  for (const k of Object.values(TIER_FIELDS)) {
    const u = (profile[k] || '').trim();
    if (u) return u;
  }
  return '';
}

export function mortgageBrokerHasPreferredContactPrefs({ formContact, lastAssistantExtracted }) {
  const fc = formContact || {};
  const ext = lastAssistantExtracted || {};
  const method = String(fc.preferred_contact_method || ext.preferred_contact_method || '').trim();
  const time = String(fc.best_time_to_contact || ext.best_time_to_contact || '').trim();
  return Boolean(method && time);
}
