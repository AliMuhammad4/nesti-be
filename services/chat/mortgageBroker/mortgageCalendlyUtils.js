/** Mortgage brokers use the same `calendly_link` as other roles (no per-tier URLs). */
export function resolveMortgageCalendlyUrl(profile) {
  if (!profile) return '';
  return String(profile.calendly_link || '').trim();
}

export function hasMortgageCalendlyConfigured(profile) {
  return Boolean(resolveMortgageCalendlyUrl(profile));
}

export function primaryCalendlyLinkForAlignment(profile) {
  return resolveMortgageCalendlyUrl(profile);
}

export function visitorHasPreferredContactPrefs({ formContact, lastAssistantExtracted }) {
  const fc = formContact || {};
  const ext = lastAssistantExtracted || {};
  const method = String(fc.preferred_contact_method || ext.preferred_contact_method || '').trim();
  const time = String(fc.best_time_to_contact || ext.best_time_to_contact || '').trim();
  return Boolean(method && time);
}

export const mortgageBrokerHasPreferredContactPrefs = visitorHasPreferredContactPrefs;
