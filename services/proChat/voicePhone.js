export function normalizeE164(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

export function pickSalesPhone({ inquiryPhone = '', profilePhone = '', userPhone = '' } = {}) {
  return normalizeE164(inquiryPhone) || normalizeE164(profilePhone) || normalizeE164(userPhone);
}
