import { tokenize, tts } from '@livekit/agents';

let elevenlabs = null;
try {
  elevenlabs = await import('@livekit/agents-plugin-elevenlabs');
} catch {
  elevenlabs = null;
}

export const DEFAULT_ELEVENLABS_VOICE = 'cjVigY5qzO86Huf0OWal';
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';

const FLASH_LANGUAGES = {
  en: 'en', fr: 'fr', es: 'es', pt: 'pt', it: 'it', de: 'de', nl: 'nl', pl: 'pl', tr: 'tr', vi: 'vi',
  tl: 'fil', ar: 'ar', ta: 'ta', hi: 'hi', zh: 'zh', ja: 'ja', ko: 'ko', ru: 'ru', uk: 'uk', el: 'el',
  id: 'id', ms: 'ms', sv: 'sv', bg: 'bg', ro: 'ro', cs: 'cs', fi: 'fi', hr: 'hr', sk: 'sk', da: 'da',
  hu: 'hu', no: 'no',
};

function text(value) {
  return String(value ?? '').trim();
}

export function elevenLabsKey(env = process.env) {
  return text(env.ELEVEN_API_KEY) || text(env.ELEVENLABS_API_KEY);
}

export function elevenLabsSpeaks(code) {
  return Boolean(FLASH_LANGUAGES[code]);
}

const SCRIPT_MODEL = 'eleven_multilingual_v2';
const SCRIPT_LANGUAGES = new Set(['ur', 'pa']);

export function elevenLabsCanSay(code) {
  return code === 'en' || elevenLabsSpeaks(code) || SCRIPT_LANGUAGES.has(code);
}

export function voiceSetupProblem(env = process.env, plugin = elevenlabs) {
  if (!elevenLabsKey(env)) return 'ELEVEN_API_KEY is not set in backend/.env';
  if (!plugin?.TTS) return 'the ElevenLabs plugin is missing (run "npm install @livekit/agents-plugin-elevenlabs@1.5.2" in backend)';
  return '';
}

export function elevenLabsOptions({ voiceId = '', model = '', speed = 1, env = process.env } = {}) {
  return {
    apiKey: elevenLabsKey(env),
    voiceId: text(voiceId) || text(env.ELEVENLABS_VOICE_ID) || DEFAULT_ELEVENLABS_VOICE,
    model: text(model) || text(env.ELEVENLABS_MODEL) || DEFAULT_ELEVENLABS_MODEL,
    language: 'en',
    voiceSettings: { stability: 0.5, similarity_boost: 0.8, speed: Number(speed) > 0 ? Number(speed) : 1 },
    streamingLatency: 4,
    wordTokenizer: new tokenize.basic.SentenceTokenizer({ minSentenceLength: 6, streamContextLength: 6 }),
  };
}

export function elevenLabsProblem(status, payload) {
  const detail = payload?.detail && typeof payload.detail === 'object' ? payload.detail : payload || {};
  const code = String(detail.status || detail.error || detail.code || '').toLowerCase();
  const message = String(detail.message || (typeof payload?.detail === 'string' ? payload.detail : '') || '');
  if (code.includes('missing_permissions') || /permission/i.test(message)) {
    return 'the API key is missing the Text to Speech permission (turn it on at elevenlabs.io → Developers → API keys)';
  }
  if (status === 401 || code.includes('invalid_api_key')) return 'the API key is not valid';
  if (code.includes('quota') || /credits|quota/i.test(message)) return 'the ElevenLabs account is out of credits';
  if (status === 404 || code.includes('voice_not_found')) return 'the voice ID was not found on this ElevenLabs account';
  if (code.includes('paid_plan') || /subscription|plan/i.test(message)) return 'this voice needs a paid ElevenLabs plan';
  return message || `ElevenLabs answered ${status}`;
}

const checks = new Map();
const CHECK_OK_MS = 10 * 60 * 1000;
const CHECK_FAIL_MS = 60 * 1000;
export const CREDITS_LOW = 1000;
export const CREDITS_TOO_LOW = 300;

// Credits used and the monthly limit. Reading them spends nothing.
async function readCredits(apiKey, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': apiKey },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const used = Number(payload?.character_count);
    const limit = Number(payload?.character_limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
    return { used, limit, left: Math.max(0, limit - used), tier: text(payload?.tier) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkElevenLabs({ voiceId = '', model = '', env = process.env, fetchImpl = fetch, timeoutMs = 2500, now = Date.now() } = {}) {
  const options = elevenLabsOptions({ voiceId, model, env });
  const cacheKey = `${options.apiKey.slice(-6)}:${options.voiceId}:${options.model}`;
  const cached = checks.get(cacheKey);
  if (cached && cached.until > now) return cached.result;
  const [result, credits] = await Promise.all([
    sayHi(options, fetchImpl, timeoutMs),
    readCredits(options.apiKey, fetchImpl, timeoutMs),
  ]);
  if (credits) result.credits = credits;
  if (result.ok && credits && credits.left < CREDITS_TOO_LOW) {
    result.ok = false;
    result.problem = `the ElevenLabs account is almost out of credits (${credits.left} of ${credits.limit} left)`;
  }
  if (!result.unchecked) checks.set(cacheKey, { result, until: now + (result.ok ? CHECK_OK_MS : CHECK_FAIL_MS) });
  return result;
}

async function sayHi(options, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result;
  try {
    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/stream?output_format=pcm_16000`,
      {
        method: 'POST',
        headers: { 'xi-api-key': options.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hi', model_id: options.model }),
        signal: controller.signal,
      },
    );
    if (response.ok) {
      result = { ok: true, problem: '' };
      response.body?.cancel?.().catch?.(() => {});
    } else {
      const payload = await response.json().catch(() => ({}));
      result = { ok: false, problem: elevenLabsProblem(response.status, payload) };
    }
  } catch {
    result = { ok: true, problem: '', unchecked: true };
  } finally {
    clearTimeout(timer);
  }
  return result;
}

export function resetElevenLabsChecks() {
  checks.clear();
}

export const FALLBACK_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
export const FAST_FAILS_TO_STAY = 2;

function reasonOf(error) {
  return String(error?.error?.message || error?.message || 'ElevenLabs could not speak');
}

export class RaviVoice extends tts.TTS {
  label = 'nesti.RaviVoice';

  constructor(primary, makeSecond, makeScript, { onFallback, onGiveUp } = {}) {
    super(primary.sampleRate, primary.numChannels || 1, { streaming: true });
    this.primary = primary;
    this.current = primary;
    this.makeSecond = makeSecond;
    this.makeScript = makeScript;
    this.scriptVoice = null;
    this.onFallback = onFallback;
    this.onGiveUp = onGiveUp;
    this.onSecond = false;
    this.secondVoice = null;
    this.fastFails = 0;
    this.gaveUp = false;
    this.language = 'en';
    this.throughHindi = false;
    this.#watch(primary);
  }

  #watch(inner) {
    inner.on('metrics_collected', (metrics) => this.emit('metrics_collected', metrics));
    inner.on('error', (error) => {
      if (inner !== this.current || this.gaveUp) return;
      const reason = reasonOf(error);
      if (!this.onSecond) {
        let next = this.secondVoice;
        if (!next) {
          try {
            next = this.makeSecond?.() || null;
          } catch {
            next = null;
          }
          if (next) {
            this.secondVoice = next;
            this.#watch(next);
          }
        }
        if (next) {
          this.current = next;
          this.onSecond = true;
          this.fastFails += 1;
          try {
            next.prewarm?.();
          } catch {
            // Connects on first use instead.
          }
          this.onFallback?.(reason, { staying: this.fastFails >= FAST_FAILS_TO_STAY });
          return;
        }
      }
      this.gaveUp = true;
      this.onGiveUp?.(reason);
    });
  }

  get model() {
    return this.current.model;
  }

  get provider() {
    return this.current.provider;
  }

  get speaksDevanagari() {
    return false;
  }
  #connectNow(voiceNow) {
    try {
      Promise.resolve(voiceNow?.currentConnection?.()).catch(() => {});
    } catch {
    }
  }

  speakLanguage(code) {
    this.language = code;
    this.throughHindi = false;
    const script = SCRIPT_LANGUAGES.has(code) && !this.onSecond && this.primary.model !== SCRIPT_MODEL;
    if (script) {
      if (!this.scriptVoice) {
        try {
          this.scriptVoice = this.makeScript?.() || null;
        } catch {
          this.scriptVoice = null;
        }
        if (this.scriptVoice) {
          this.#watch(this.scriptVoice);
          try {
            this.scriptVoice.prewarm?.();
          } catch {
          }
        }
      }
      if (this.scriptVoice) {
        this.current = this.scriptVoice;
        this.#connectNow(this.scriptVoice);
        return 'elevenlabs';
      }
    } else if (!this.onSecond) {
      this.current = this.primary;
    }
    if (!this.onSecond) {
      this.primary.updateOptions({ language: FLASH_LANGUAGES[code] || 'en' });
      this.#connectNow(this.primary);
    }
    return 'elevenlabs';
  }

  warmScript() {
    if (this.onSecond || this.primary.model === SCRIPT_MODEL) return;
    if (!this.scriptVoice && this.makeScript) {
      try {
        this.scriptVoice = this.makeScript() || null;
      } catch {
        this.scriptVoice = null;
      }
      if (this.scriptVoice) {
        this.#watch(this.scriptVoice);
        try {
          this.scriptVoice.prewarm?.();
        } catch {
        }
      }
    }
    if (this.scriptVoice) this.#connectNow(this.scriptVoice);
  }

  retryFast() {
    if (!this.onSecond || this.gaveUp || this.fastFails >= FAST_FAILS_TO_STAY) return false;
    this.onSecond = false;
    this.speakLanguage(this.language);
    return true;
  }

  prewarm({ urdu = true } = {}) {
    try {
      this.primary.prewarm?.();
    } catch {
    }
    this.#connectNow(this.primary);
    if (urdu) this.warmScript();
  }

  synthesize(line) {
    return this.current.synthesize(line);
  }

  stream(options) {
    const conn = options?.connOptions || {};
    return this.current.stream({ ...options, connOptions: { ...conn, maxRetry: 1, retryIntervalMs: 300, timeoutMs: conn.timeoutMs || 10000 } });
  }

  async close() {
    await Promise.allSettled([this.primary.close(), this.scriptVoice?.close(), this.secondVoice?.close()]);
  }
}

export function secondElevenLabsOptions({ voiceId = '', model = '', speed = 1, env = process.env } = {}) {
  const options = elevenLabsOptions({ voiceId, model, speed, env });
  return {
    ...options,
    voiceId: text(env.ELEVENLABS_FALLBACK_VOICE_ID) || options.voiceId,
    model: text(env.ELEVENLABS_FALLBACK_MODEL) || FALLBACK_ELEVENLABS_MODEL,
    language: undefined,
  };
}

export function scriptElevenLabsOptions({ voiceId = '', speed = 1, env = process.env } = {}) {
  const options = elevenLabsOptions({ voiceId, speed, env });
  return { ...options, model: SCRIPT_MODEL, language: undefined };
}

export function createElevenLabsVoice({ voiceId, model, speed, onFallback, onGiveUp, plugin = elevenlabs, env = process.env }) {
  return new RaviVoice(
    new plugin.TTS(elevenLabsOptions({ voiceId, model, speed, env })),
    () => new plugin.TTS(secondElevenLabsOptions({ voiceId, model, speed, env })),
    () => new plugin.TTS(scriptElevenLabsOptions({ voiceId, speed, env })),
    { onFallback, onGiveUp },
  );
}
