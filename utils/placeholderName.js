export const PLACEHOLDER_FIRST_NAME = 'New';
export const PLACEHOLDER_LAST_NAME = 'User';

export function isPlaceholderName(firstName, lastName) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  return (!first && !last) || (first === PLACEHOLDER_FIRST_NAME && last === PLACEHOLDER_LAST_NAME);
}

export function displayNameOrFallback(user, fallback = '') {
  if (isPlaceholderName(user?.first_name, user?.last_name)) return fallback;
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ') || fallback;
}

export function presentableNames(user) {
  if (isPlaceholderName(user?.first_name, user?.last_name)) {
    return { first_name: '', last_name: '', name: '' };
  }
  const first_name = String(user?.first_name || '').trim();
  const last_name = String(user?.last_name || '').trim();
  return { first_name, last_name, name: [first_name, last_name].filter(Boolean).join(' ') };
}
