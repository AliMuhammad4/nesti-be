export const clip = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
export const faqText = (value, max) => String(value || '').trim().slice(0, max);
export const list = (value, allowed, max) => {
  const source = Array.isArray(value) ? value : [];
  const kept = [];
  source.forEach((item) => {
    const id = clip(item, 80);
    if (!id || !allowed.includes(id) || kept.includes(id) || kept.length >= max) return;
    kept.push(id);
  });
  return kept;
};
export const freeList = (value, max, itemMax) => {
  const source = Array.isArray(value) ? value : [];
  const kept = [];
  source.forEach((item) => {
    const text = clip(item, itemMax);
    if (!text || kept.some((entry) => entry.toLowerCase() === text.toLowerCase()) || kept.length >= max) return;
    kept.push(text);
  });
  return kept;
};
