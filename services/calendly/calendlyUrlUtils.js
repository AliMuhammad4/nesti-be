export function extractCalendlySlugFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const t = url.trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes('://') ? t : `https://${t}`);
    const host = u.hostname.replace(/^www\./i, '');
    if (!host.endsWith('calendly.com')) return null;
    const seg = u.pathname.replace(/^\//, '').split('/')[0];
    return seg ? seg.toLowerCase() : null;
  } catch {
    const m = t.match(/calendly\.com\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
  }
}
