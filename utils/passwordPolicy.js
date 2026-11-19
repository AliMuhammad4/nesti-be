/** Same rule the signup, reset, and change password screens show. */
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include uppercase, lowercase, number, and special character';

const SPECIAL_CHAR = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

export function isStrongPassword(value) {
  const password = String(value || '');
  if (password.length < 8) return false;
  return /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && SPECIAL_CHAR.test(password);
}
