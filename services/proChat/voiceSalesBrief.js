import User from '../../models/User.js';
import ClientProfile from '../../models/ClientProfile.js';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import VoiceAgentSalesSetting from '../../models/VoiceAgentSalesSetting.js';
import { CLIENT_PLANS, canonicalClientTier } from '../client/plans.js';
import { BILLING_PLANS } from '../billing/plans.js';
import { CALL_LANGUAGES, urduAmount } from './callLanguage.js';
import { createClientCheckoutSession } from '../client/clientSubscriptionService.js';
import { createCheckoutSessionForUser } from '../billing/subscriptionCheckoutService.js';
import { LANGUAGE_MODES, languageMode } from './callLanguage.js';
import { pipelineRoleBrief, professionalPlansBrief, questionsWithOverrides } from './salesPipeline.js';
import { HOME_STEPS, SITE_FEATURES, siteFeaturesBrief } from './landingFeatures.js';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// 0..999999 in words, e.g. 129 -> "one hundred twenty-nine".
function numberWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  if (n < 1000000) return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`;
  return String(n);
}

export const BUILTIN_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin'];

// Ravi's voice is ElevenLabs only: OpenAI hearing -> OpenAI LLM ->
// ElevenLabs voice ("pipeline"). Older saved settings (OpenAI realtime,
// Deepgram, Cartesia, Inworld) are read as ElevenLabs; nothing is rewritten.
export const VOICE_ENGINES = ['pipeline'];
export const STT_MODELS = ['openai/gpt-4o-mini-transcribe'];
export const TTS_MODELS = {
  eleven_flash_v2_5: { label: 'ElevenLabs Flash v2.5 (fastest)', defaultVoice: '' },
  eleven_multilingual_v2: { label: 'ElevenLabs Multilingual v2 (richer, slower)', defaultVoice: '' },
};

export function voiceEngine() {
  return 'pipeline';
}

export function sttModel(value) {
  const model = text(value).toLowerCase();
  return STT_MODELS.includes(model) ? model : STT_MODELS[0];
}

// An ElevenLabs model id; anything else (an old Deepgram, Cartesia or
// Inworld value) reads as '' = use ELEVENLABS_MODEL / Flash v2.5.
export function ttsModel(value) {
  const model = text(value).toLowerCase();
  return TTS_MODELS[model] ? model : '';
}

// An ElevenLabs voice ID (20 letters and digits); old Deepgram preset names,
// Cartesia UUIDs and LiveKit "v_" ids read as '' = ELEVENLABS_VOICE_ID / Eric.
export function ttsVoice(value) {
  const voice = text(value);
  return /^[A-Za-z0-9]{20}$/.test(voice) ? voice : '';
}

const LEADS = 'The public page and chatbot collect the inquiry into the lead inbox.';
const EMAIL = 'Draft, refine, and preview a follow-up in their situation, then send it.';
const NURTURE = 'A sequence of follow-up emails, including bulk drafts.';

export const GUIDE_FIELDS = {
  client: [
    { id: 'goal', label: 'Goal', hint: 'Why clients call. Reassure first; do not open with a plan.', text: 'Clients come to buy, sell, invest, or explore. Many are first-time buyers who feel unsure, so reassure them and keep it simple.' },
    { id: 'agent', label: 'Real estate agent', hint: 'Search through the offer.', text: 'Match a real estate agent for search, listings, showings, and offers.' },
    { id: 'broker', label: 'Mortgage broker', hint: 'Financing only.', text: 'Match a mortgage broker for financing, pre-approval, and renewal.' },
    { id: 'lawyer', label: 'Real estate lawyer', hint: 'Agreement through closing.', text: 'Match a real estate lawyer for the agreement, title, and closing.' },
    { id: 'tools', label: 'Client tools', hint: 'Only when they ask how Nesti helps them.', text: 'Inside their account: homeownership progress tracking, a savings and down-payment tracker, budget tools, personalized recommendations, and support.' },
  ],
  agent: [
    { id: 'leads', label: 'Lead capture', hint: 'How an inquiry becomes a lead.', text: LEADS },
    { id: 'email', label: 'AI email', hint: 'One follow-up, not a tour of the editor.', text: EMAIL },
    { id: 'nurture', label: 'Nurture', hint: 'The follow-up sequence.', text: NURTURE },
    { id: 'storefront', label: 'Storefront', hint: 'Agent templates only.', text: 'A public page the admin can edit, with investor and seller expert templates. The chatbot on that page qualifies new inquiries.' },
    { id: 'work', label: 'Daily work', hint: 'Buyers, sellers, and listings.', text: 'Talk buyers and sellers, listings, showings, and offers.' },
  ],
  broker: [
    { id: 'leads', label: 'Lead capture', hint: 'How an inquiry becomes a lead.', text: LEADS },
    { id: 'email', label: 'AI email', hint: 'One follow-up, not a tour of the editor.', text: EMAIL },
    { id: 'nurture', label: 'Nurture', hint: 'The follow-up sequence.', text: NURTURE },
    { id: 'storefront', label: 'Storefront', hint: 'Broker templates only.', text: 'A public page the admin can edit. Templates include renewal, first home, and commercial. The chatbot qualifies new inquiries.' },
    { id: 'work', label: 'Daily work', hint: 'Financing, not listings.', text: 'Talk pre-approval, affordability, renewal, and first-home financing.' },
  ],
  lawyer: [
    { id: 'leads', label: 'Lead capture', hint: 'How an inquiry becomes a lead.', text: LEADS },
    { id: 'email', label: 'AI email', hint: 'One follow-up, not a tour of the editor.', text: EMAIL },
    { id: 'nurture', label: 'Nurture', hint: 'The follow-up sequence.', text: NURTURE },
    { id: 'storefront', label: 'Storefront', hint: 'The lawyer page only.', text: 'A public page the admin can edit. The storefront template is the newcomer closing page. The chatbot qualifies new inquiries.' },
    { id: 'work', label: 'Daily work', hint: 'Agreement through closing.', text: 'Talk the purchase agreement, title, lender instructions, and closing.' },
  ],
};

export function composeGuide(role, texts) {
  const fields = GUIDE_FIELDS[role] || GUIDE_FIELDS.agent;
  return fields
    .map((field, index) => {
      const custom = Array.isArray(texts) ? texts[index] : texts?.[field.id];
      return `${field.label}: ${text(custom ?? field.text)}`;
    })
    .join(' ');
}

export function parseGuide(role, saved) {
  const fields = GUIDE_FIELDS[role];
  let rest = text(saved);
  if (!fields || !rest) return null;
  const values = [];
  for (let index = 0; index < fields.length; index += 1) {
    const prefix = `${fields[index].label}: `;
    if (!rest.startsWith(prefix)) return null;
    rest = rest.slice(prefix.length);
    if (index === fields.length - 1) {
      values.push(rest);
      break;
    }
    const marker = ` ${fields[index + 1].label}: `;
    const at = rest.indexOf(marker);
    if (at < 0) return null;
    values.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  return values;
}

export const SERVICE_SEEDS = {
  client: composeGuide('client'),
  agent: composeGuide('agent'),
  broker: composeGuide('broker'),
  lawyer: composeGuide('lawyer'),
};

function text(value) {
  return String(value || '').trim();
}

// "$49.99" -> "forty-nine dollars and ninety-nine cents". Works for any
// price, so a plan price change never needs a matching edit here.
export function speakAmount(display) {
  const raw = text(display).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return text(display).replace(/\$/g, '');
  const [whole, fraction = ''] = raw.split('.');
  const dollars = Number(whole);
  const cents = Number(fraction.padEnd(2, '0'));
  const dollarWords = `${numberWords(dollars)} ${dollars === 1 ? 'dollar' : 'dollars'}`;
  return cents ? `${dollarWords} and ${numberWords(cents)} ${cents === 1 ? 'cent' : 'cents'}` : dollarWords;
}

export function allowedVoice(value, fallback = 'ash') {
  const voice = text(value).toLowerCase();
  if (BUILTIN_VOICES.includes(voice)) return voice;
  if (value === 'female') return 'coral';
  if (value === 'male') return 'ash';
  return fallback;
}

function planLines(plans) {
  return Object.values(plans || {})
    .filter((plan) => text(plan?.name) && Number(plan?.amount) > 0)
    .map((plan) => `${plan.name} at ${speakAmount((Number(plan.amount) / 100).toFixed(2))} a month`)
    .join('. ');
}

// "Essential $29.99, Plus $49.99, Premium $129" from the same plan config.
export function planPriceDigits(role, plans) {
  const client = briefKey(role) === 'client';
  return Object.values(plans || (client ? CLIENT_PLANS : BILLING_PLANS))
    .filter((plan) => text(plan?.name) && Number(plan?.amount) > 0)
    .map((plan) => {
      const cents = Number(plan.amount);
      return `${plan.name} $${cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)}`;
    })
    .join(', ');
}

// For a call in another language. Number words translated from English came
// out wrong ("forty nine" said word by word as چالیس نو), so prices are
// written as digits and the voice reads them in that language.
export function otherLanguagePriceNote(role, plans) {
  const prices = planPriceDigits(role, plans);
  if (!prices) return '';
  return `Prices on this call: write every price as digits with a dollar sign, exactly as here: ${prices} a month (US dollars). This replaces the rule to say money in words. Never write a price as number words, never translate or round it, and never split the digits.`;
}

export function serviceLine(role, settings) {
  const key = briefKey(role);
  const custom = text(settings?.[`${key}_services`]);
  return custom || SERVICE_SEEDS[key] || SERVICE_SEEDS.agent;
}

export function briefKey(role) {
  const value = text(role).toLowerCase();
  if (value === 'client') return 'client';
  if (value === 'mortgage_broker' || value === 'broker') return 'broker';
  if (value === 'lawyer') return 'lawyer';
  if (value === 'agent') return 'agent';
  return 'agent';
}

// Prices come from the same plan config that checkout and the pricing page use
// (services/client/plans.js and services/billing/plans.js), read on every call.
export function livePlanFacts(role, plans, language = 'en') {
  const client = briefKey(role) === 'client';
  const list = plans || (client ? CLIENT_PLANS : BILLING_PLANS);
  if (language && language !== 'en') return otherLanguagePlanFacts(client, list, language);
  const prices = planLines(list);
  if (!prices) {
    return 'Plan prices are not available on this call. Do not say any price; say a specialist will confirm the pricing. Do not invent prices or a discount.';
  }
  const kind = client ? 'Client plans (for buyers, sellers, and investors)' : 'Professional plans (for agents, mortgage brokers, and lawyers)';
  return `Say money in words, never with a dollar sign. Name at most one plan. ${kind}, billed monthly: ${prices}. These are the only plans and prices. Never quote any other price, and do not invent a discount.`;
}

// Prices for a call in another language, written so the model copies them
// instead of translating English number words ("forty-nine" came out as
// چالیس نو). Urdu gets the spoken Urdu words from code; other languages get
// the digits, which the voice reads in that language.
function otherLanguagePlanFacts(client, list, language) {
  const plans = Object.values(list || {}).filter((plan) => text(plan?.name) && Number(plan?.amount) > 0);
  if (!plans.length) {
    return 'Plan prices are not available on this call. Do not say any price; say a specialist will confirm the pricing. Do not invent prices or a discount.';
  }
  const urdu = language === 'ur';
  const lines = plans.map((plan) => {
    const cents = Number(plan.amount);
    const digits = `$${cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)}`;
    return urdu ? `${plan.name} ${urduAmount(cents)}` : `${plan.name} ${digits}`;
  }).join(', ');
  const kind = client ? 'Client plans (for buyers, sellers, and investors)' : 'Professional plans (for agents, mortgage brokers, and lawyers)';
  const how = urdu
    ? 'Say each price exactly with these Urdu words, copied as written; never build number words yourself.'
    : `Write each price as these digits with the dollar sign and let the voice read them in ${CALL_LANGUAGES[language]?.name || 'this language'}; never write a price as number words.`;
  return `Name at most one plan. ${kind}, US dollars a month: ${lines}. ${how} Never change, round, convert, or translate an amount. These are the only plans and prices; do not invent a discount.`;
}

// What Nesti is, so Ravi answers from facts instead of guessing.
export function nestiFacts(role) {
  const client = briefKey(role) === 'client';
  const plans = client
    ? 'Do not list what is inside a plan unless they ask. If they ask, name the plan and its monthly price only, and say the Nesti team confirms the details.'
    : `Professional plans: ${professionalPlansBrief()}. Higher plans are also placed more prominently.`;
  const trial = client
    ? 'Clients get a three-day free trial.'
    : 'Professionals get a three-day free trial that starts when the Nesti team approves their account, after signup and document review.';
  return `Nesti facts (the only facts you may state): Nesti is a real estate platform in Canada. Clients are buyers, sellers, and investors; professionals are real estate agents, mortgage brokers, and real estate lawyers. Nesti matches clients with the right professionals. ${plans} ${trial} Prices are US dollars, billed monthly. Nesti does not replace their agent, broker, or lawyer, and does not give legal or mortgage advice. After they agree, the signup link is sent to them. Never read a web address. If you are not sure, say the Nesti team can help. Never invent features, numbers, people, or promises.`;
}

// Caller words that mean "end this call": goodbye, a request to hang up, or
// dismissive or abusive language.
const CALLER_END = /\b(bye|goodbye|good bye|hang up|end (the|this) call|f+u+c*k+ (off|you)|piss off|leave me alone|stop calling|don'?t call me|shut up|get lost|go away)\b/i;
// Ravi lines that close the call.
const CLOSING_LINE = /\b(take care|goodbye|good bye|bye|have a (great|good|nice|wonderful|lovely) (day|one|evening|night|week|weekend)|thanks? (you )?for (your time|calling|the call)|talk (to you )?soon)\b/i;
const DECLINE = /\b(no thanks|no,? thank you|not interested|(don'?t|do not) (want|need)|not now|not right now|maybe later|later|not today|i'?ll pass|not for me|no need|too expensive|not going (to|with)|won'?t|think about it)\b/i;
const ANYTHING_ELSE = /\b(anything else|something else|any other (question|thing))\b/i;
const NOTHING_ELSE = /^(no|nope|nah|nothing|that'?s (all|it)|i'?m good|all good|no thanks|no,? thank you)\b/i;

// The same checks in the other call languages (Urdu, Punjabi in both scripts,
// Hindi, French, Spanish, Tamil, Arabic, Roman Urdu). Matched as whole words
// on the caller's or Ravi's line.
const OTHER_CALLER_END = ['خدا حافظ', 'اللہ حافظ', 'الله حافظ', 'دفع ہو', 'دفا ہو', 'دفعہ ہو', 'فون بند کر', 'کال بند کر', 'چلے جاؤ', 'بکواس بند', 'ਰੱਬ ਰਾਖਾ', 'ਖ਼ੁਦਾ ਹਾਫ਼ਿਜ਼', 'ਖੁਦਾ ਹਾਫਿਜ਼', 'ਦਫ਼ਾ ਹੋ', 'ਦਫਾ ਹੋ', 'ਫ਼ੋਨ ਬੰਦ', 'ਫੋਨ ਬੰਦ', 'अलविदा', 'फ़ोन रखो', 'फोन रखो', 'दफ़ा हो', 'au revoir', 'raccroche', 'laisse-moi tranquille', 'fiche-moi la paix', 'adiós', 'adios', 'hasta luego', 'cuelga', 'déjame en paz', 'போய் வருகிறேன்', 'போயிட்டு வரேன்', 'مع السلامة', 'khuda hafiz', 'allah hafiz', 'dafa ho', 'daffa ho', 'dafa ho ja'];
const OTHER_CLOSING = ['خدا حافظ', 'اللہ حافظ', 'الله حافظ', 'ਰੱਬ ਰਾਖਾ', 'ਖ਼ੁਦਾ ਹਾਫ਼ਿਜ਼', 'ਖੁਦਾ ਹਾਫਿਜ਼', 'अलविदा', 'au revoir', 'bonne journée', 'adiós', 'adios', 'que tenga un buen día', 'que tengas un buen día', 'மீண்டும் சந்திப்போம்', 'مع السلامة', 'khuda hafiz', 'allah hafiz'];
const OTHER_DECLINE = ['نہیں', 'نئیں', 'نہیں چاہیے', 'بعد میں', 'سوچنا', 'سوچ کر', 'سوچوں گا', 'مہنگا', 'دلچسپی نہیں', 'ضرورت نہیں', 'ਨਹੀਂ', 'ਨਹੀ', 'ਬਾਅਦ ਵਿੱਚ', 'ਸੋਚਣਾ', 'ਸੋਚ ਕੇ', 'ਮਹਿੰਗਾ', 'नहीं', 'बाद में', 'सोचना', 'सोच कर', 'महंगा', 'non', 'pas intéressé', 'pas intéressée', 'plus tard', 'trop cher', 'je vais réfléchir', 'no gracias', 'no me interesa', 'más tarde', 'luego', 'muy caro', 'lo pensaré', 'lo voy a pensar', 'வேண்டாம்', 'இல்லை', 'பிறகு', 'لا', 'nahi', 'nahin', 'baad mein', 'mehnga'];
const NOT_A_DECLINE = ['کیوں نہیں', 'ਕਿਉਂ ਨਹੀਂ', 'क्यों नहीं', 'pourquoi pas', 'por qué no', 'porque no'];
const OTHER_ANYTHING_ELSE = ['کوئی اور', 'اور کوئی', 'کچھ اور', 'ਹੋਰ ਕੋਈ', 'ਕੋਈ ਹੋਰ', 'ਕੁਝ ਹੋਰ', 'कुछ और', 'कोई और', 'autre chose', 'algo más', 'otra cosa', 'வேறு ஏதாவது'];
const OTHER_NOTHING_ELSE = ['نہیں', 'نئیں', 'بس', 'کچھ نہیں', 'ਨਹੀਂ', 'ਬੱਸ', 'ਕੁਝ ਨਹੀਂ', 'नहीं', 'बस', 'कुछ नहीं', 'non', 'non merci', 'rien', 'nada', 'no gracias', 'இல்லை', 'எதுவும் இல்லை'];
// Words that show Ravi named a price or a plan in any language.
const PRICE_WORDS = /\$\s?\d|\d\s?\$|ڈالر|ਡਾਲਰ|डॉलर|डालर|dólares|dollars?|dollar|டாலர்|دولار/i;
const PLAN_WORDS = /\bplan\b|پلان|ਪਲਾਨ|ਪਲੈਨ|प्लान|forfait|abonnement|suscripción|plan\b|திட்ட|خطة|essential|premium|plus|enterprise|standard|basic|ایسنشل|پریمیم|پلس|ਐਸੈਂਸ਼ੀਅਲ|ਪ੍ਰੀਮੀਅਮ|ਪਲੱਸ/i;
const QUESTION = /[?؟]/;

function plainWords(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lower-cased words in any script, punctuation removed (keeps combining marks).
function anyWords(value) {
  return ` ${text(value).toLowerCase().replace(/[^\p{L}\p{M}\p{N}'\s-]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

function hasPhrase(words, phrases) {
  return phrases.some((phrase) => words.includes(` ${phrase.toLowerCase()} `));
}

// True when the caller wants the call over (bye, hang up, rude or abusive),
// or answers no to "anything else?".
export function callerWantsToEnd(callerText, lastRaviText = '') {
  const words = anyWords(callerText);
  if (hasPhrase(words, OTHER_CALLER_END)) return true;
  if (hasPhrase(anyWords(lastRaviText), OTHER_ANYTHING_ELSE) && hasPhrase(words, OTHER_NOTHING_ELSE)
    && words.trim().split(' ').length <= 4 && !QUESTION.test(text(callerText))) return true;
  const said = plainWords(callerText);
  if (!said) return false;
  if (CALLER_END.test(said)) return true;
  if (!ANYTHING_ELSE.test(text(lastRaviText)) || !NOTHING_ELSE.test(said)) return false;
  // "No, one more question" is not a goodbye.
  return said.split(' ').length <= 5 && !/\b(question|but|more|one thing|actually|wait|how|what|why|can|could)\b/.test(said);
}

// A caller who says they want nothing from this call at all ("I don't want
// anything", "not interested", "مجھے کچھ نہیں چاہیے"). Plain "no" is not one:
// it is often the answer to a yes/no question ("No, I want to rent").
const CALL_DECLINE = /\b(i'?m not interested|not interested|(i )?(don'?t|do not) (want|need) anything|nothing needed|i need nothing|i want nothing|no need for anything)\b/i;
const OTHER_CALL_DECLINE = ['کچھ نہیں چاہیے', 'کچھ نہیں چاہئے', 'کچھ نئیں چاہیے', 'کچھ نئیں چاہئے', 'کچھ بھی نہیں چاہیے', 'دلچسپی نہیں', 'کوئی دلچسپی نہیں', 'انٹرسٹ نہیں', 'انٹرسٹڈ نہیں', 'کسی چیز کی ضرورت نہیں', 'کوئی ضرورت نہیں', 'کجھ نئیں چاہیدا', 'کجھ نہیں چاہیدا', 'کجھ وی نئیں چاہیدا', 'کوئی لوڑ نئیں', 'کسے چیز دی لوڑ نئیں', 'ਕੁਝ ਨਹੀਂ ਚਾਹੀਦਾ', 'ਕੁਝ ਵੀ ਨਹੀਂ ਚਾਹੀਦਾ', 'ਕੋਈ ਲੋੜ ਨਹੀਂ', 'ਦਿਲਚਸਪੀ ਨਹੀਂ', 'कुछ नहीं चाहिए', 'कुछ भी नहीं चाहिए', 'दिलचस्पी नहीं', 'kuch nahi chahiye', 'kuch nahin chahiye', 'kuch nai chahiye', 'kuch bhi nahi chahiye', 'kuj nai chahida', 'kujh nahi chahida', 'kujh nai chahida', 'koi lor nai', 'dilchaspi nahi', 'interest nahi', 'interested nahi', 'koi zaroorat nahi', 'koi zarurat nahi'];
// Words that mean the caller still wants something ("not interested in
// buying, I want to rent", "I don't want anything, but how does it work").
const CALL_DECLINE_BUT = /\b(but|rent|renting|buy|buying|sell|selling|invest|looking|want to|wanna|question|how|what|why|which|where|when|tell me|explain|only|just want|except)\b/i;
const OTHER_CALL_DECLINE_BUT = ['لیکن', 'مگر', 'کرایہ', 'کرائے', 'خریدنا', 'بیچنا', 'سوال', 'کیسے', 'کیوں', 'کونسا', 'کون سا', 'کہاں', 'کب', 'بتاؤ', 'بتائیں', 'بتاو', 'سمجھاؤ', 'چاہتا ہوں', 'چاہتی ہوں', 'صرف', 'پر مجھے', 'پر یہ', 'ਪਰ', 'ਕਿਰਾਇਆ', 'ਕਿਵੇਂ', 'ਕਿਉਂ', 'ਦੱਸੋ', 'लेकिन', 'मगर', 'किराया', 'कैसे', 'क्यों', 'बताओ', 'lekin', 'magar', 'kiraya', 'kaise', 'kyun', 'batao', 'bataen'];

// True when the caller says they want nothing at all from this call. Ravi
// then says one goodbye and hangs up, with no "ask if you have a question".
export function callerDeclinesCall(callerText) {
  const line = text(callerText);
  if (!line || QUESTION.test(line)) return false;
  const words = anyWords(line);
  if (words.trim().split(' ').length > 12) return false;
  const said = plainWords(line);
  if (hasPhrase(words, OTHER_CALL_DECLINE_BUT) || CALL_DECLINE_BUT.test(said)) return false;
  return hasPhrase(words, OTHER_CALL_DECLINE) || CALL_DECLINE.test(said);
}

// True when Ravi's line is a closing line and does not ask anything.
export function isClosingLine(raviText) {
  const line = text(raviText);
  if (!line || QUESTION.test(line)) return false;
  return CLOSING_LINE.test(line) || hasPhrase(anyWords(line), OTHER_CLOSING);
}

// True when the caller turns down a plan Ravi just offered.
export function isPlanDecline(callerText, lastRaviText = '') {
  const offered = /\b(plan|dollars|subscription|sign up|start it|get started|begin)\b/i.test(text(lastRaviText))
    || PRICE_WORDS.test(text(lastRaviText)) || PLAN_WORDS.test(text(lastRaviText));
  if (!offered) return false;
  const words = anyWords(callerText);
  if (!hasPhrase(words, NOT_A_DECLINE) && hasPhrase(words, OTHER_DECLINE)) return true;
  const said = plainWords(callerText);
  if (!said) return false;
  return DECLINE.test(said) || /^(no|nope|nah)\b/.test(said);
}

// True when Ravi's own line offers a plan ("Would you like to start the
// Essential plan?", or a plan with its price).
export function isPlanPitch(raviText) {
  const line = text(raviText);
  // Any language: a price, or a plan name in a question.
  if (PRICE_WORDS.test(line) && (PLAN_WORDS.test(line) || QUESTION.test(line))) return true;
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(line) && PLAN_WORDS.test(line) && QUESTION.test(line)) return true;
  if (!/\bplan\b/i.test(line)) return false;
  return /\bdollars?\b/i.test(line) || /\b(would you like|do you want|shall we|ready) to (start|begin|go|proceed|get started|sign up|try)\b/i.test(line);
}

// Added to Ravi's instructions once he has offered a plan.
export function pitchedPlanNote() {
  return 'Call state: you have already offered a plan. Do not offer, name, or ask about any plan or price again unless the caller asks about plans or prices. Help with what they ask instead.';
}

// Added to Ravi's instructions once the caller has turned a plan down.
export function declinedPlansNote(count) {
  if (!count) return '';
  if (count >= 2) {
    return 'Call state: the caller has declined plans twice. Do not pitch, name, or price any plan again. Wrap up now: one short polite closing sentence, then call end_call.';
  }
  return 'Call state: the caller declined a plan. Do not pitch, name, or offer any plan or price again unless they ask about one. Say it is no problem and offer to answer any question.';
}

// The brief is the same text in every call language, so OpenAI can reuse its
// cached prompt after a language switch; the call-language prices go in a
// short note at the very end.
export function callLanguagePriceNote(role, language = 'en') {
  if (!language || language === 'en') return '';
  return `Prices for this call language (say these instead of the English price words above): ${livePlanFacts(role, null, language)}`;
}

export function liveSalesInstructions({ role, caller, settings, language = 'en' }) {
  const name = text(caller?.name);
  const note = text(caller?.note);
  const who = name
    ? `The caller's name is ${name}. Greet them by that name once.`
    : 'No name is on file. Do not invent a name.';
  const filed = note
    ? `One note already on file: ${note}. Use it only when it fits what they just said.`
    : 'No earlier note is on file. Do not invent one.';
  return `You are Ravi on a live Nesti sales call. Your first spoken turn introduces you. After that, do not introduce yourself again unless they ask who you are.
Phone call: one or two short sentences, under 35 words, then stop. At most one question, at the end. No lists, markdown, or emojis. In English, say prices in words. In another call language, say prices exactly as the note at the end gives them.
Answer only what they just asked. Do not repeat their words or an answer you already gave. Their question comes first, then at most one question. If they ask who you are or how you can help, answer in one short sentence from the Nesti facts. If they ask why you were slow or say they are still there, answer that in one short sentence and continue. Do not apologize for it and do not ask buy or sell again.
You are a business consultant, not a salesperson: listen, understand their challenge, and show how Nesti solves it. Open each reply with a few warm words that show you heard them (vary them; use the note's suggested acknowledgement when it gives one), then answer.
Decision path: 1. Hear their goal and ask one short question about their situation before any plan. Do not pitch yet. Do not call record_sales_outcome on the greeting or after your own plan mention. The Sales pipeline note on each turn lists what is known (never ask it again) and the next questions. 2. Explain the one topic that solves the challenge they named, tied to their situation. 3. When the note says to recommend, name one plan and its monthly price, say why it fits, and ask once if they would like to start it or see a demo. Bring up a plan on your own at most once. 4. Call record_sales_outcome only after they clearly agree, clearly decline, or clearly ask for a callback, a demo, or a person.
If they say it is too expensive, tie the cost to one extra client or the hours saved, then offer the next plan down once. Do not invent a discount.
Objections: setup is online signup, then team approval before the trial. Other software: Nesti keeps leads, follow-ups, and booking in one place, and the team confirms any integration. Next steps: the signup link (interested), a demo (callback, next_step demo), a summary email only if they say yes (follow_up_consent), a person (next_step human_handoff). Never ask for a SIN, social security number, bank, or card details. If they say stop calling, confirm it, record declined with next_step do_not_call, and call end_call.
A decline ("no", "not interested", "not now", "maybe later") is final. Say "No problem.", call record_sales_outcome with declined, and do not pitch again unless they ask. If they decline twice, one short closing sentence, then call end_call.
If they want nothing at all ("I don't want anything", "مجھے کچھ نہیں چاہیے"), one short goodbye and call end_call. A plain "no" to one question is not this.
Listings are homes in Canada and you cannot read them out; do not open with that. Say Nesti matches them with homes and a local agent, then offer to note what they want. Never judge a budget. Off Nesti (food, music, jokes, other businesses), one short sentence that you only help with their home plans, then one question. Never recommend a business or person.
Apologize once if they are upset, then not again. Abusive: one calm closing line and call end_call.
Call end_call on bye, hang up, no to "anything else?", or a closing line such as "Take care" or "Goodbye". Do not end on an unclear phrase.
Never list more than one plan. Never say the purchase is complete. Never read a web address.
Language: the greeting is English. English is the default. Switch only after a clear full sentence in another language. On that turn, do not apologize and do not ask buy or sell again. One word, a name, or a fragment never changes it. Urdu in Urdu script (never Devanagari; area, city, and property words stay in English). Punjabi in the caller's script. Hindi in Devanagari only when they speak Hindi. Do not mix languages. Tool calls stay in English. In Urdu or Punjabi, under 18 words.
The questions he asks come only from the Sales pipeline note on each turn: at most one per reply, the one that fits what they just said, never one already answered. Background knowledge, not questions (use it to answer and to show you understand; never list it, ask it, or go through it in order): ${serviceLine(role, settings)}
${siteFeaturesBrief(briefKey(role))}
${pipelineRoleBrief(role)}
${livePlanFacts(role, null, 'en')}
${nestiFacts(role)}
${who} ${filed}${callLanguagePriceNote(role, language) ? `\n${callLanguagePriceNote(role, language)}` : ''}`;
}

// A short in-memory cache so back-to-back test calls don't each hit Mongo for
// the same settings row. Saves on the admin page cleared it via the write path.
let settingsCache = null;
let lastGoodSettings = undefined;
let hasLastGoodSettings = false;
const SETTINGS_TTL_MS = 30_000;

export function invalidateSalesSettingsCache() {
  settingsCache = null;
}

export function lastCachedSettings() {
  return hasLastGoodSettings ? lastGoodSettings : null;
}

export async function loadSalesSettings({ fresh = false } = {}) {
  if (!fresh && settingsCache && settingsCache.until > Date.now()) return settingsCache.value;
  try {
    const value = await VoiceAgentSalesSetting.findOne({ key: 'sales' }).lean();
    settingsCache = { value, until: Date.now() + SETTINGS_TTL_MS };
    lastGoodSettings = value;
    hasLastGoodSettings = true;
    return value;
  } catch (error) {
    if (hasLastGoodSettings) return lastGoodSettings;
    throw error;
  }
}

export function speechSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 1;
  return Math.min(1.25, Math.max(0.9, Math.round(speed * 100) / 100));
}

export function responseEagerness(value) {
  const raw = text(value).toLowerCase();
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return 'high';
}

export function bargeIn(value) {
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return true;
}

export function silenceSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 12;
  return Math.min(20, Math.max(12, Math.round(seconds)));
}

function guideEditor(doc, role) {
  const saved = text(doc?.[`${role}_services`]);
  const parsed = parseGuide(role, saved);
  const fields = GUIDE_FIELDS[role];
  return {
    using_builtin: !saved,
    custom_block: parsed || !saved ? '' : saved,
    builtin: fields.map((field) => ({ id: field.id, label: field.label, hint: field.hint, text: field.text })),
    fields: fields.map((field, index) => ({
      id: field.id,
      label: field.label,
      hint: field.hint,
      text: parsed ? parsed[index] : field.text,
    })),
  };
}

function siteFeatureView(item) {
  return { id: item.id, title: item.title, description: item.description, questions: item.questions };
}

function questionEditor(saved, role) {
  const builtin = Object.fromEntries(questionsWithOverrides(role).map((item) => [item.id, item]));
  return questionsWithOverrides(role, saved).map((item) => ({
    id: item.id,
    builtin: builtin[item.id].text,
    builtin_answers: builtin[item.id].answers,
    builtin_reply: builtin[item.id].reply,
    text: item.text,
    answers: item.answers,
    reply: item.reply,
  }));
}

export function salesSettingsView(doc) {
  return {
    voice: allowedVoice(doc?.voice, 'marin'),
    speech_speed: speechSpeed(doc?.speech_speed),
    vad_eagerness: responseEagerness(doc?.vad_eagerness),
    barge_in: bargeIn(doc?.barge_in),
    silence_seconds: silenceSeconds(doc?.silence_seconds),
    language_mode: languageMode(doc?.language_mode),
    language_modes: LANGUAGE_MODES,
    client_services: text(doc?.client_services),
    agent_services: text(doc?.agent_services),
    broker_services: text(doc?.broker_services),
    lawyer_services: text(doc?.lawyer_services),
    guides: {
      client: guideEditor(doc, 'client'),
      agent: guideEditor(doc, 'agent'),
      broker: guideEditor(doc, 'broker'),
      lawyer: guideEditor(doc, 'lawyer'),
    },
    questions: {
      client: questionEditor(doc?.client_questions, 'client'),
      agent: questionEditor(doc?.agent_questions, 'agent'),
      broker: questionEditor(doc?.broker_questions, 'broker'),
      lawyer: questionEditor(doc?.lawyer_questions, 'lawyer'),
    },
    seeds: SERVICE_SEEDS,
    site_features: {
      client: [...SITE_FEATURES.client.map(siteFeatureView), ...SITE_FEATURES.investor.map((item) => ({ ...siteFeatureView(item), tag: 'Investors' }))],
      agent: [...SITE_FEATURES.agent].map(siteFeatureView),
      broker: [...SITE_FEATURES.broker].map(siteFeatureView),
      lawyer: [...SITE_FEATURES.lawyer].map(siteFeatureView),
      home: HOME_STEPS.map(siteFeatureView),
    },
    voices: BUILTIN_VOICES,
    voice_engine: voiceEngine(doc?.voice_engine),
    stt_model: sttModel(doc?.stt_model),
    tts_model: ttsModel(doc?.tts_model),
    tts_voice: ttsVoice(doc?.tts_voice),
    engines: VOICE_ENGINES,
    stt_models: STT_MODELS,
    tts_models: Object.entries(TTS_MODELS).map(([id, meta]) => ({ id, label: meta.label, default_voice: meta.defaultVoice })),
    sample_saved: Boolean(text(doc?.sample_key)),
    clone_ready: Boolean(text(doc?.clone_voice_id)),
    // Recorded-sample cloning only works when an ElevenLabs key is set.
    clone_provider_ready: Boolean(text(process.env.ELEVEN_API_KEY) || text(process.env.ELEVENLABS_API_KEY)),
    clone_error: text(doc?.clone_error),
  };
}

export async function loadCaller(call) {
  const type = text(call?.voice_target_type);
  const id = text(call?.voice_target_id);
  if (!id) return { name: '', note: '', userId: '', kind: type };
  if (type === 'client') {
    const client = await ClientProfile.findById(id).populate('user_id', 'first_name last_name').lean();
    const user = client?.user_id;
    return {
      name: [user?.first_name, user?.last_name].map(text).filter(Boolean).join(' '),
      note: text(client?.home_goal),
      userId: user?._id ? String(user._id) : '',
      kind: 'client',
    };
  }
  if (type === 'sales') {
    const inquiry = await EnterpriseInquiry.findById(id).select('full_name company_name message user_id').lean();
    return {
      name: text(inquiry?.full_name),
      note: [inquiry?.company_name, inquiry?.message].map(text).filter(Boolean).join('. '),
      userId: inquiry?.user_id ? String(inquiry.user_id) : '',
      kind: 'professional',
    };
  }
  const lead = await LeadMatch.findById(id).select('lead_profile_id').lean();
  const profile = lead?.lead_profile_id
    ? await LeadProfile.findById(lead.lead_profile_id).select('identity.full_name intent_summary.primary_intent budget_profile.latest_budget_text').lean()
    : null;
  return {
    name: text(profile?.identity?.full_name),
    note: [profile?.intent_summary?.primary_intent, profile?.budget_profile?.latest_budget_text].map(text).filter(Boolean).join('. '),
    userId: '',
    kind: 'lead',
  };
}

// Maps what Ravi said ("Premium", "the Essential plan") to a client tier.
function clientTier(planLabel) {
  const raw = text(planLabel).toLowerCase();
  if (raw.includes('premium')) return 'premium';
  if (raw.includes('essential')) return 'essential';
  return canonicalClientTier(raw.replace(/\bplan\b/g, '').trim()) || 'plus';
}

function professionalPlanKey(planLabel) {
  const raw = text(planLabel).toLowerCase();
  if (raw.includes('enterprise') || raw.includes('premium')) return 'enterprise';
  if (raw.includes('basic')) return 'basic';
  return 'standard';
}

export async function prepareSignupLink({ kind, userId, planLabel }) {
  const fallback = { spoken: 'A specialist will send the next step.', url: '' };
  if (!text(userId)) return fallback;
  try {
    if (kind === 'client') {
      const session = await createClientCheckoutSession(userId, clientTier(planLabel));
      return session?.sessionUrl
        ? { spoken: 'The signup link is ready.', url: session.sessionUrl }
        : fallback;
    }
    const user = await User.findById(userId);
    if (!user) return fallback;
    const result = await createCheckoutSessionForUser(user, professionalPlanKey(planLabel));
    const url = result?.ok ? text(result.session?.url) : '';
    return url ? { spoken: 'The signup link is ready.', url } : fallback;
  } catch {
    return fallback;
  }
}
