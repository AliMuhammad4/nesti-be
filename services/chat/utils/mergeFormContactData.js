export function mergeFormContactData(base = {}, patch = {}) {
  const prev = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const next = { ...prev };
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    next[k] = v;
  }
  return next;
}
