function trimStr(value) {
  if (value == null) return '';
  return String(value).trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_MIN_DIGITS = 7;

/** Count numeric digits so formatted numbers (+1 (555) 010-9999) still qualify. */
function phoneDigitCount(value) {
  const s = trimStr(value);
  if (!s) return 0;
  return (s.match(/\d/g) || []).length;
}

function phoneSatisfies(value) {
  return phoneDigitCount(value) >= PHONE_MIN_DIGITS;
}

/**
 * Mirrors core required fields from settings Personal + Business (basics).
 * Used by GET /auth/profile and API gates for professionals.
 */
export function evaluateProfessionalProfileSetup(user, professionalProfile) {
  const p = professionalProfile || {};
  const first = trimStr(user?.first_name);
  const last = trimStr(user?.last_name);
  const email = trimStr(user?.email);
  const phoneRaw = trimStr(p.phone);
  const company = trimStr(p.company_name);
  const location = trimStr(p.location);
  const targetNeighborhoods = trimStr(p.target_neighborhoods);
  /** Basics "Location" or Style & Metrics "target neighborhoods" both count as service area. */
  const serviceArea = location.length > 0 || targetNeighborhoods.length > 0;

  const emailOk = EMAIL_RE.test(email);
  const phoneOk = phoneSatisfies(phoneRaw);
  const personalComplete = first.length > 0 && last.length > 0 && emailOk && phoneOk;
  const businessComplete = company.length > 0 && serviceArea;

  const missingFields = [];
  if (!first) missingFields.push('first_name');
  if (!last) missingFields.push('last_name');
  if (!emailOk) missingFields.push('email');
  if (!phoneOk) missingFields.push('phone');
  if (!company) missingFields.push('company_name');
  if (!serviceArea) missingFields.push('location_or_target_neighborhoods');

  return {
    personal_complete: personalComplete,
    business_complete: businessComplete,
    is_complete: personalComplete && businessComplete,
    missing_fields: missingFields,
  };
}
