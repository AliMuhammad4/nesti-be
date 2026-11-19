let sessionIo = null;
export function registerSessionSocketServer(io) {
  sessionIo = io || null;
}

export function disconnectUserSessions(userId) {
  const uid = String(userId || '').trim();
  if (!sessionIo || !uid) return false;
  try {
    sessionIo.in(`user:${uid}`).disconnectSockets(true);
    return true;
  } catch {
    return false;
  }
}
