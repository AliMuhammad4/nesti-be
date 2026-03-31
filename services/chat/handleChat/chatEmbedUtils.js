export function getLastAssistantExtractedData(historyDocs) {
  for (let i = historyDocs.length - 1; i >= 0; i -= 1) {
    const m = historyDocs[i];
    if (m.role === 'assistant') {
      return m.meta?.ai_metadata?.extracted_data || {};
    }
  }
  return {};
}

export function withCalendlyConversationTracking(url, conversationObjectId) {
  if (!url || !conversationObjectId) return url || '';
  const id = String(conversationObjectId);
  try {
    const u = new URL(url);
    u.searchParams.set('utm_content', id);
    u.searchParams.set('utm_source', 'nesti');
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}utm_content=${encodeURIComponent(id)}&utm_source=nesti`;
  }
}
