// One rule for names people type in (signup, personal info, client settings).
export const PERSON_NAME_MAX = 60;
export const PERSON_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
export const PERSON_NAME_MESSAGE = 'Names can only use letters, spaces, apostrophes, hyphens and periods';

export function isValidPersonName(value) {
  const name = String(value ?? '').trim();
  return name.length <= PERSON_NAME_MAX && PERSON_NAME_PATTERN.test(name);
}
