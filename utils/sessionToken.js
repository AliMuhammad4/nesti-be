export function sessionTokenProblem(decoded, user) {
  if (!decoded || typeof decoded !== 'object') return 'invalid';
  if (decoded.purpose) return 'wrong_purpose';
  if (!decoded.id) return 'invalid';
  if (user && Number(decoded.tv || 0) !== Number(user.token_version || 0)) return 'revoked';
  return null;
}
