export function normalizePhoneE164(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.replace(/[\s().\-\u00a0]/g, '');
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) return '';
  return raw;
}

export const PHONE_INVALID_MESSAGE = 'Please enter a valid mobile number with country code';
export const PHONE_TAKEN_MESSAGE = 'This mobile number is already registered with another account';

export function isPhoneDuplicateError(error) {
  if (error?.code !== 11000) return false;
  if (error?.keyPattern && Object.prototype.hasOwnProperty.call(error.keyPattern, 'phone')) return true;
  return /phone_1/.test(String(error?.message || ''));
}
