export const CALENDLY_WEBHOOK_ERROR_KINDS = {
  plan:       'calendly_plan',
  /** Access token revoked/expired and the refresh token no longer works. */
  reconnect:  'calendly_reconnect',
  /** Calendly answered 403 for a permission/scope reason (not the plan). */
  permission: 'calendly_permission',
  other:      'other',
};

const PLAN_PATTERNS = /upgrade|standard plan|standard \(or higher\)|paid calendly|paid plan|free trial.*expir|trial (has )?(expired|ended)|not available on your (current )?plan|plan does not (support|include)|subscription (has )?(expired|lapsed)|billing issue|past due|payment failed/i;
const RECONNECT_PATTERNS = /\(401\)|unauthenticated|invalid_grant|invalid_token|token refresh failed \(400\)|no refresh token|access (was )?revoked|reconnect calendly/i;
const PERMISSION_PATTERNS = /\(403\)|permission denied|you do not have permission|insufficient[_ ]scope|forbidden/i;

/**
 * Classify a Calendly API error message:
 * plan block (paid feature) vs. lost access (reconnect) vs. missing permission (403 without a plan reason).
 */
export function calendlyWebhookErrorKind(message) {
  const m = String(message || '');
  if (PLAN_PATTERNS.test(m)) return CALENDLY_WEBHOOK_ERROR_KINDS.plan;
  if (RECONNECT_PATTERNS.test(m)) return CALENDLY_WEBHOOK_ERROR_KINDS.reconnect;
  if (PERMISSION_PATTERNS.test(m)) return CALENDLY_WEBHOOK_ERROR_KINDS.permission;
  return CALENDLY_WEBHOOK_ERROR_KINDS.other;
}

export const CALENDLY_RECONNECT_USER_MESSAGE =
  'Calendly access expired or was removed. Reconnect Calendly in Settings to resume booking sync.';

export const CALENDLY_PERMISSION_USER_MESSAGE =
  'Calendly did not allow Nesti to set up booking sync for this account. Reconnect Calendly in Settings and approve the requested access.';

export function userFacingCalendlyRegisterError(kind, original) {
  if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.plan) {
    return (
      'Calendly requires a Standard (or higher) plan to create booking webhooks. ' +
      'Your OAuth link still works, but new bookings will not be pushed to Nesti until your Calendly account is upgraded.'
    );
  }
  if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.reconnect) return CALENDLY_RECONNECT_USER_MESSAGE;
  if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.permission) return CALENDLY_PERMISSION_USER_MESSAGE;
  return String(original || 'Webhook registration failed.').slice(0, 1200);
}
