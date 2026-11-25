// Which language Ravi answers in on a voice call, and which voice speaks it.
//
// The language is decided here from the caller's own words (the script they
// are written in, then common words for languages that share the Latin
// script), not left to the model. It only changes on a full sentence, so one
// word, a name, or a noisy fragment never flips the call into another language.

export const LANGUAGE_MODES = ['auto', 'english'];

export function languageMode(value) {
  return String(value || '').trim().toLowerCase() === 'english' ? 'english' : 'auto';
}

// code -> spoken name and how it is written.
export const CALL_LANGUAGES = {
  en: { name: 'English', script: 'English (Latin letters)' },
  fr: { name: 'French', script: 'French' },
  es: { name: 'Spanish', script: 'Spanish' },
  pt: { name: 'Portuguese', script: 'Portuguese' },
  it: { name: 'Italian', script: 'Italian' },
  de: { name: 'German', script: 'German' },
  nl: { name: 'Dutch', script: 'Dutch' },
  pl: { name: 'Polish', script: 'Polish' },
  tr: { name: 'Turkish', script: 'Turkish' },
  vi: { name: 'Vietnamese', script: 'Vietnamese' },
  tl: { name: 'Tagalog', script: 'Tagalog (Latin letters)' },
  ur: { name: 'Urdu', script: 'Urdu script (Nastaliq/Arabic letters), never Devanagari. Keep listing details in English letters and digits: area, street and city names (Johar Town, DHA, Toronto), property words (house, apartment, condo, bedroom, washroom, kanal, marla, sq ft, listing, offer, agent) and their numbers (3 bedroom, 1200 sq ft). Plan prices stay exactly as given under the plans. If the caller is clearly speaking Punjabi, reply in Punjabi in Shahmukhi (the same Urdu letters)' },
  ar: { name: 'Arabic', script: 'Arabic script' },
  fa: { name: 'Persian', script: 'Persian (Arabic letters)' },
  pa: { name: 'Punjabi', script: 'the script the caller\'s Punjabi is written in: Shahmukhi (Urdu letters, for example میں تہاڈی مدد کر سکدا ہاں) when their words are in Urdu letters, otherwise Gurmukhi script (ਗੁਰਮੁਖੀ letters, for example ਮੈਂ ਤੁਹਾਡੀ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ); never Devanagari' },
  ta: { name: 'Tamil', script: 'Tamil script' },
  hi: { name: 'Hindi', script: 'Devanagari script' },
  bn: { name: 'Bengali', script: 'Bengali script' },
  gu: { name: 'Gujarati', script: 'Gujarati script' },
  te: { name: 'Telugu', script: 'Telugu script' },
  kn: { name: 'Kannada', script: 'Kannada script' },
  ml: { name: 'Malayalam', script: 'Malayalam script' },
  or: { name: 'Odia', script: 'Odia script' },
  zh: { name: 'Mandarin Chinese', script: 'Simplified Chinese characters' },
  ja: { name: 'Japanese', script: 'Japanese' },
  ko: { name: 'Korean', script: 'Hangul' },
  ru: { name: 'Russian', script: 'Cyrillic' },
  uk: { name: 'Ukrainian', script: 'Cyrillic' },
  el: { name: 'Greek', script: 'Greek letters' },
  he: { name: 'Hebrew', script: 'Hebrew letters' },
  th: { name: 'Thai', script: 'Thai script' },
};

// Languages the caller can speak and hear Ravi answer in.
export function spokenLanguages() {
  return Object.keys(CALL_LANGUAGES);
}

const SCRIPTS = [
  ['ta', /[\u0B80-\u0BFF]/g],
  ['pa', /[\u0A00-\u0A7F]/g],
  ['hi', /[\u0900-\u097F]/g],
  ['bn', /[\u0980-\u09FF]/g],
  ['gu', /[\u0A80-\u0AFF]/g],
  ['or', /[\u0B00-\u0B7F]/g],
  ['te', /[\u0C00-\u0C7F]/g],
  ['kn', /[\u0C80-\u0CFF]/g],
  ['ml', /[\u0D00-\u0D7F]/g],
  ['th', /[\u0E00-\u0E7F]/g],
  ['ko', /[\uAC00-\uD7AF\u1100-\u11FF]/g],
  ['ja', /[\u3040-\u30FF]/g],
  ['zh', /[\u4E00-\u9FFF]/g],
  ['he', /[\u0590-\u05FF]/g],
  ['el', /[\u0370-\u03FF]/g],
  ['cyrillic', /[\u0400-\u04FF]/g],
  ['arabic', /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g],
];

// Letters only Urdu (and Punjabi Shahmukhi) use; Persian-only and Arabic-only letters.
const URDU_LETTERS = /[ٹڈڑںےۓھہۂ]/;
const PERSIAN_LETTERS = /[پچژگک]/;
const ARABIC_ONLY = /[ةىأإؤئ]/;
const UKRAINIAN_LETTERS = /[іїєґ]/i;

// Punjabi words in Urdu letters (Shahmukhi) that Urdu doesn't use. Two or
// more in a turn: the caller speaks Punjabi.
const SHAHMUKHI_PUNJABI = new Set('تسیں تساں تہاڈا تہاڈی تہاڈے تواڈا تواڈی تواڈے ساڈا ساڈی ساڈے کتھے ایتھے اوتھے ہن نئیں نیئں چنگا چنگی چنگے دسو دسیں دسنا لبھ لبھدا لبھدی لبھدے کول سکدا سکدی سکدے سکدیاں چاہندا چاہندی چاہندے کردا کردی کردے اے ہیگا ہیگی ہیگے ویکھ ویکھو ویکھنا جاندا جاندی جاندے رہیا رہی سی گل گلاں تے نوں توں اینا کنا کیہڑا کیہڑی کیوں جی ہووے ہوندا ہوندی'.split(' ').filter((w) => !['کیوں', 'جی', 'تے', 'رہی'].includes(w)));

function shahmukhiPunjabi(raw) {
  let hits = 0;
  for (const word of String(raw || '').split(/[\s،؟.!,?]+/)) if (SHAHMUKHI_PUNJABI.has(word)) hits += 1;
  return hits >= 2;
}

// Common short words per Latin-script language, for telling them apart.
const LATIN_WORDS = {
  en: 'the and you i is are to a of in it that for what how can my me we have do not this with yes no please want need looking house home buy sell',
  fr: 'le la les et je vous tu est une un des du de pour que qui pas oui non merci bonjour je suis cherche maison acheter vendre avec mais comment est-ce',
  es: 'el la los las y yo usted es una un de del para que pero sí no gracias hola quiero busco casa comprar vender cómo con estoy',
  pt: 'o os a as e eu você é um uma do da para que não sim obrigado olá quero casa comprar vender como com estou',
  it: 'il lo la gli le e io lei è un una di del per che non sì grazie ciao voglio casa comprare vendere come con sono',
  de: 'der die das und ich sie ist ein eine nicht ja nein danke hallo möchte haus kaufen verkaufen wie mit bin',
  nl: 'de het een en ik u is niet ja nee dank hallo wil huis kopen verkopen hoe met ben',
  tl: 'ang ng mga sa ako ikaw ay hindi oo po salamat gusto bahay bumili magbenta paano',
};
// Roman Urdu (Urdu typed in English letters), e.g. "mujhe Lahore mein ghar
// chahiye". Words that are also common English words are left out.
const ROMAN_URDU = new Set('mujhe mujhay mujhko mjhe chahiye chahiyay chahye chahta chahti chahte hain hai nahi nahin nhi kya kyun kyon kaise kaisa kaisi kitna kitne kitni kahan kahaan kab mein mai ghar makan makaan acha accha achha theek thik haan jee bhai yaar aap aapka aapki aapko apka apki apko humein hamein mera meri mere tum tumhara wala wali walay liye lekin magar abhi bohat bahut bhi saath bata batao bataein batayen batain dekh dekhna karna karein kariye kijiye rahe raha rahi hoon hun gaya gayi zaroor shukriya marla kanal kothi chahiay matlab samajh pata'.split(' '));

const LATIN_SETS = Object.fromEntries(Object.entries(LATIN_WORDS).map(([code, words]) => [code, new Set(words.split(' '))]));

function wordsOf(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean);
}

function latinLanguage(words, raw) {
  if (/[ğşı]/i.test(raw)) return 'tr';
  if (/[łąęśźż]/i.test(raw)) return 'pl';
  if (/[ơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(raw)) return 'vi';
  const scores = Object.fromEntries(Object.keys(LATIN_SETS).map((code) => [code, 0]));
  let roman = 0;
  for (const word of words) {
    if (ROMAN_URDU.has(word)) roman += 1;
    for (const [code, set] of Object.entries(LATIN_SETS)) if (set.has(word)) scores[code] += 1;
  }
  // Roman Urdu only when those words clearly outnumber English (more than two).
  if (roman >= 3 && roman > scores.en) return 'ur';
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, top] = ranked[0];
  const second = ranked[1][1];
  if (!top) return '';
  if (best === 'en') return top > second ? 'en' : '';
  // Another Latin language needs clear evidence over English and the rest.
  return top >= 2 && top > second && top > scores.en ? best : '';
}

// The language one caller turn is in, or '' when it is unclear.
export function detectTurnLanguage(transcript) {
  const raw = String(transcript || '');
  const letters = raw.match(/\p{L}/gu) || [];
  if (!letters.length) return '';
  let best = '';
  let bestCount = 0;
  for (const [code, pattern] of SCRIPTS) {
    const count = (raw.match(pattern) || []).length;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  // Mostly Latin letters (or no other script dominates).
  if (!best || bestCount < letters.length * 0.5) return latinLanguage(wordsOf(raw), raw);
  if (best === 'arabic') {
    if (shahmukhiPunjabi(raw)) return 'pa';
    if (URDU_LETTERS.test(raw)) return 'ur';
    if (ARABIC_ONLY.test(raw) && !PERSIAN_LETTERS.test(raw)) return 'ar';
    return 'ur';
  }
  if (best === 'cyrillic') return UKRAINIAN_LETTERS.test(raw) ? 'uk' : 'ru';
  if (best === 'ja' || best === 'zh') return /[\u3040-\u30FF]/.test(raw) ? 'ja' : 'zh';
  return best;
}

// A full sentence: at least three words (or four characters for languages
// written without spaces).
function isFullTurn(transcript, code) {
  const raw = String(transcript || '').trim();
  if (['zh', 'ja', 'th'].includes(code)) return (raw.match(/\p{L}/gu) || []).length >= 4;
  return wordsOf(raw).length >= 3;
}

// The call language after this caller turn. It stays the same unless the
// caller clearly spoke a full sentence in another language.
export function nextCallLanguage(current, transcript, mode = 'auto') {
  const now = CALL_LANGUAGES[current] ? current : 'en';
  if (languageMode(mode) === 'english') return 'en';
  const heard = detectTurnLanguage(transcript);
  if (!heard || heard === now || !CALL_LANGUAGES[heard]) return now;
  if (!isFullTurn(transcript, heard)) return now;
  return heard;
}

// Urdu, Punjabi and Hindi sound alike to speech recognition, which writes the
// same speaker in Urdu script one turn and Gurmukhi or Devanagari the next.
// Moving between them needs two full turns in a row, so the reply language
// (and the voice's accent) doesn't flip back and forth.
const CLOSE_LANGUAGES = new Set(['ur', 'pa', 'hi']);

export function createLanguageTracker(mode = 'auto', start = 'en') {
  let current = CALL_LANGUAGES[start] ? start : 'en';
  let pending = '';
  return {
    get current() {
      return current;
    },
    heard(transcript) {
      let next = nextCallLanguage(current, transcript, mode);
      if (next === 'hi') next = 'ur';
      if (next === current) {
        if (detectTurnLanguage(transcript) === current) pending = '';
        return current;
      }
      // English to another language switches on one full sentence. Once the
      // call is in another language, leaving it takes two full sentences in a
      // row, so a stray line (or a mis-heard one) doesn't flip the reply
      // language and the voice back and forth.
      // Two exceptions: one English sentence of five or more words goes back to
      // English, and only Urdu, Punjabi and Hindi (which sound alike) need two
      // in a row between each other.
      const backToEnglish = next === 'en' && wordsOf(transcript).length >= 5;
      const needsTwo = next === 'en' ? !backToEnglish : CLOSE_LANGUAGES.has(current) && CLOSE_LANGUAGES.has(next);
      if (current !== 'en' && needsTwo && pending !== next) {
        pending = next;
        return current;
      }
      pending = '';
      current = next;
      return current;
    },
  };
}

// Urdu number words 0-99, so a price is spoken correctly ($29.99 is
// انتیس ڈالر ننانوے سینٹ, not a word-by-word "twenty nine").
export const URDU_NUMBERS = ['صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس', 'بیس', 'اکیس', 'بائیس', 'تئیس', 'چوبیس', 'پچیس', 'چھبیس', 'ستائیس', 'اٹھائیس', 'انتیس', 'تیس', 'اکتیس', 'بتیس', 'تینتیس', 'چونتیس', 'پینتیس', 'چھتیس', 'سینتیس', 'اڑتیس', 'انتالیس', 'چالیس', 'اکتالیس', 'بیالیس', 'تینتالیس', 'چوالیس', 'پینتالیس', 'چھیالیس', 'سینتالیس', 'اڑتالیس', 'انچاس', 'پچاس', 'اکاون', 'باون', 'ترپن', 'چون', 'پچپن', 'چھپن', 'ستاون', 'اٹھاون', 'انسٹھ', 'ساٹھ', 'اکسٹھ', 'باسٹھ', 'تریسٹھ', 'چونسٹھ', 'پینسٹھ', 'چھیاسٹھ', 'سڑسٹھ', 'اڑسٹھ', 'انہتر', 'ستر', 'اکہتر', 'بہتر', 'تہتر', 'چوہتر', 'پچہتر', 'چھہتر', 'ستتر', 'اٹھہتر', 'اناسی', 'اسی', 'اکاسی', 'بیاسی', 'تراسی', 'چوراسی', 'پچاسی', 'چھیاسی', 'ستاسی', 'اٹھاسی', 'نواسی', 'نوے', 'اکانوے', 'بانوے', 'ترانوے', 'چورانوے', 'پچانوے', 'چھیانوے', 'ستانوے', 'اٹھانوے', 'ننانوے'];

function urduNumber(value) {
  const n = Math.floor(Number(value) || 0);
  if (n < 100) return URDU_NUMBERS[n];
  if (n < 1000) {
    const rest = n % 100;
    return `${URDU_NUMBERS[Math.floor(n / 100)]} سو${rest ? ` ${URDU_NUMBERS[rest]}` : ''}`;
  }
  if (n < 100000) {
    const rest = n % 1000;
    return `${urduNumber(Math.floor(n / 1000))} ہزار${rest ? ` ${urduNumber(rest)}` : ''}`;
  }
  return String(n);
}

// A price in cents as it should be said in Urdu, e.g. 2999 -> انتیس ڈالر ننانوے سینٹ.
export function urduAmount(cents) {
  const total = Math.round(Number(cents) || 0);
  const dollars = Math.floor(total / 100);
  const rest = total % 100;
  return `${urduNumber(dollars)} ڈالر${rest ? ` ${urduNumber(rest)} سینٹ` : ''}`;
}

// Told to the model on every turn, so it never guesses the language itself.
// voiceCan: which languages the call's voice can speak (the ElevenLabs
// voice passes its own list).
export function languageCue(code, mode = 'auto', voiceCan = () => true) {
  if (languageMode(mode) === 'english') return 'Reply in English only, whatever language the caller uses.';
  const lang = CALL_LANGUAGES[code] || CALL_LANGUAGES.en;
  if (code && code !== 'en' && !voiceCan(code)) {
    return `The caller speaks ${lang.name}, which this voice cannot speak. Reply in English and say briefly that you can continue in English.`;
  }
  // Urdu and Punjabi use the slower Multilingual v2 voice: shorter replies
  // start and finish sooner.
  const short = code === 'ur' || code === 'pa' ? ' Keep it under 18 words, one or two short sentences.' : '';
  return `Reply in ${lang.name}, written in ${lang.script}. Do not mix languages; only plan names and Nesti stay as they are.${short}`;
}

export function callLanguageNote(code, mode = 'auto', voiceCan = undefined) {
  const lang = CALL_LANGUAGES[code] || CALL_LANGUAGES.en;
  return `Call state: the call language is ${lang.name}. ${languageCue(code, mode, voiceCan)}`;
}

// Hint for speech recognition: which languages to expect and how each is written.
