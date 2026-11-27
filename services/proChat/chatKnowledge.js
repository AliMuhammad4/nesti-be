import { loadLandingChatSettings } from '../chat/nestiLanding/landingChatConfig.js';
import { enabledRoleCustomization, replyFromSavedFaq } from '../chat/nestiLanding/nestiLandingFlow.js';

const CACHE_MS = 60_000;
let cache = { value: null, until: 0, loading: null };

export function chatKnowledgeLoaded() {
  return cache.until > 0;
}

export async function warmChatKnowledge() {
  if (cache.until > Date.now()) return cache.value;
  if (cache.loading) return cache.loading;
  cache.loading = loadLandingChatSettings()
    .then((value) => {
      cache = { value: value || null, until: Date.now() + CACHE_MS, loading: null };
      return cache.value;
    })
    .catch(() => {
      cache = { value: cache.value, until: Date.now() + 5000, loading: null };
      return cache.value;
    });
  return cache.loading;
}

export function resetChatKnowledge(value = null) {
  cache = { value, until: value ? Date.now() + CACHE_MS : 0, loading: null };
}

export function chatFaqAnswer(audience, line) {
  const spoken = String(line || '').trim();
  if (!spoken) return '';
  try {
    return replyFromSavedFaq(enabledRoleCustomization(cache.value || {}, audience || 'client'), spoken);
  } catch {
    return '';
  }
}
