export const CALENDLY_WEBHOOK_ERROR_KINDS = {
  plan:  'calendly_plan',
  other: 'other',
};
const PLAN_PATTERNS = /\(403\)|\b403\b.*permission|Permission Denied|upgrade your calendly|upgrade to (the )?standard|standard plan|free trial.*expir|not available on your (current )?plan/i;
export function calendlyWebhookErrorKind(message) {
  const m = String(message || '');
  if (PLAN_PATTERNS.test(m)) return CALENDLY_WEBHOOK_ERROR_KINDS.plan;
  return CALENDLY_WEBHOOK_ERROR_KINDS.other;
}

export function userFacingCalendlyRegisterError(kind, original) {
  if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.plan) {
    return (
      'Calendly requires a Standard (or higher) plan to create booking webhooks. ' +
      'Your OAuth link still works, but new bookings will not be pushed to Nesti until your Calendly account is upgraded.'
    );
  }
  return String(original || 'Webhook registration failed.').slice(0, 1200);
}
