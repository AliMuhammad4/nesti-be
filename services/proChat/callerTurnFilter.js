const MADE_UP = [
  /\bthis is (a )?nesti\b/i,
  /\bnesti (is a )?(real estate )?(company|sales call)\b/i,
  /\bcompany name\b/i,
  /\bhow (can|may) i (help|assist) you( today)?\b/i,
  /\b(thanks|thank you) for watching\b/i,
  /\bsubscribe to (my|the|our) channel\b/i,
  /\breal estate sales call in canada\b/i,
  /سبسکرائب/,
];

function words(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  const pool = new Set(b);
  return a.filter((word) => pool.has(word)).length / a.length;
}

export function isPhantomTurn(transcript, { lastRaviText = '', lastCallerText = '', lastCallerAt = 0, now = Date.now() } = {}) {
  const said = String(transcript || '').trim();
  const heard = words(said);
  if (!heard.length) return true;
  if (MADE_UP.some((pattern) => pattern.test(said))) return true;
  const ravi = words(lastRaviText);
  if (heard.length >= 5 && overlap(heard, ravi) >= 0.9 && overlap(ravi, heard) >= 0.7) return true;
  const previous = words(lastCallerText);
  if (heard.length >= 3 && previous.length && now - lastCallerAt < 6000 && heard.join(' ') === previous.join(' ')) return true;
  return false;
}
