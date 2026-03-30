import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';

export function validateWidgetRoleAgainstProfile(candidate, profile) {
  if (!PROFESSIONAL_TYPE_VALUES.includes(candidate)) {
    return {
      ok: false,
      message: `widget_role must be one of: ${PROFESSIONAL_TYPE_VALUES.join(', ')}`,
    };
  }
  if (profile && candidate !== profile.professional_type) {
    return {
      ok: false,
      message: 'widget_role must match your account professional type',
    };
  }
  return { ok: true };
}
