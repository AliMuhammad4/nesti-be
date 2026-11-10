/**
 * Round 5: fixed lines in every detector language (one localized table), lawyer company documents for
 * existing accounts (read-time upgrade of the exact prior default), and Test My AI lawyer / broker investor
 * and market blocks from the persona and chat text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOOKING_COPY,
  INVESTOR_OPENING_QUESTION,
  INVESTOR_REFINEMENT_QUESTION,
  INVESTOR_STRATEGY_CONFIRM_QUESTION,
  PAUSE_COPY,
  TURN_FALLBACK,
  VISITOR_WORDS,
} from '../services/professionalAssistant/localizedReplyCopy.js';
import { applyAgentOpeningFunnel, investorOpeningQuestion, replyLanguage, turnFallbackReply } from '../services/professionalAssistant/replyStyle.js';
import {
  appendCalendlyBookingLink,
  holdFurtherQuestions,
  isDocumentDeclineMessage,
  offerConsultationAfterSkippedUpload,
  userSignalsBookingIntent,
  visitorSkipsDocumentRequest,
} from '../services/chat/utils/chatBookingReply.js';
import {
  DOCUMENT_CATALOG_VERSION,
  sanitizeAssistant,
  upgradeLegacyDocumentRequests,
} from '../services/professionalAssistant/assistantSettings.js';
import { localizedDocumentName } from '../services/chat/documents/documentCoverage.js';
import { previewIntakeSignals } from '../services/chat/handleChat/previewSignals.js';
import { buildLawyerSystemPrompt } from '../services/chat/prompts/lawyerPrompt.js';
import { buildMortgageBrokerSystemPrompt } from '../services/chat/prompts/mortgageBrokerPrompt.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DETECTED = ['english', 'french', 'spanish', 'arabic', 'urdu', 'hindi', 'punjabi', 'tamil', 'mandarin'];
const fixed = (language) => ({ applied: true, languages: [language], auto_detect_language: false });

// 1. Languages
test('1a: the detector emits each table language from real text', () => {
  const samples = {
    arabic: 'مرحبا أريد شقة', hindi: 'नमस्ते मुझे घर चाहिए', punjabi: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਮੈਨੂੰ ਘਰ ਚਾਹੀਦਾ', tamil: 'வணக்கம் எனக்கு வீடு வேண்டும்',
    mandarin: '你好，我想买房', french: 'Bonjour, je cherche', spanish: 'Hola, busco casa',
  };
  for (const [language, text] of Object.entries(samples)) {
    const setting = language === 'mandarin' ? { applied: true, languages: [] } : { applied: true, languages: ['english'] };
    assert.equal(replyLanguage(setting, text), language, language);
  }
});

test('1b: every detected language has every fixed line; nothing else has rows', () => {
  const tables = { INVESTOR_OPENING_QUESTION, INVESTOR_REFINEMENT_QUESTION, INVESTOR_STRATEGY_CONFIRM_QUESTION, BOOKING_COPY, PAUSE_COPY, TURN_FALLBACK };
  for (const [name, table] of Object.entries(tables)) {
    assert.deepEqual(Object.keys(table).sort(), [...DETECTED].sort(), name);
  }
  for (const language of DETECTED) {
    for (const key of ['matchesOff', 'needContact', 'clientTypeBlocked', 'skipListings', 'skipListingsInvestor']) {
      assert.ok(turnFallbackReply(key, language), `${key} ${language}`);
    }
    assert.ok(BOOKING_COPY[language].label && BOOKING_COPY[language].sendLater && BOOKING_COPY[language].pickTime);
  }
  assert.equal(turnFallbackReply('skipListings', 'other'), '');
  assert.equal(turnFallbackReply('skipListings', 'cantonese'), '');
});

test('1c: investor opening, refinement, and conflict lines in Hindi, Punjabi, Tamil, and Mandarin', () => {
  const base = { isOpeningFormTurn: true, flowRole: 'agent', isInvestorVisitor: true, investmentGoalKnown: true };
  for (const language of ['hindi', 'punjabi', 'tamil', 'mandarin']) {
    const out = applyAgentOpeningFunnel('—', { ...base, setting: fixed(language) });
    assert.ok(out.includes(INVESTOR_REFINEMENT_QUESTION[language]), language);
    const conflict = applyAgentOpeningFunnel('—', { ...base, strategyGoalConflict: true, setting: fixed(language) });
    assert.ok(conflict.includes(INVESTOR_STRATEGY_CONFIRM_QUESTION[language]), language);
  }
  assert.match(investorOpeningQuestion(fixed('mandarin'), '', '', 'Toronto'), /^很好的开始。 在Toronto，/);
  assert.match(investorOpeningQuestion(fixed('hindi'), '', '', 'Toronto'), /Toronto में,/);
  // Languages with no row keep the model reply.
  assert.equal(applyAgentOpeningFunnel('Thanks.', { ...base, setting: fixed('other') }), 'Thanks.');
});

test('1d: skipped-documents note and booking label in the new languages; custom CTA wins', () => {
  const url = 'https://calendly.com/pro/intro';
  for (const language of ['hindi', 'punjabi', 'tamil', 'mandarin']) {
    const out = offerConsultationAfterSkippedUpload('—', url, { allowSchedule: true, language });
    assert.ok(out.includes(BOOKING_COPY[language].sendLater), language);
    assert.ok(out.includes(`[${BOOKING_COPY[language].label}](${url})`), language);
    assert.doesNotMatch(out, /You can send|Book an appointment/);
  }
  assert.match(appendCalendlyBookingLink('ठीक है।', url, { force: true, language: 'hindi', label: 'Book an Investment Consultation' }), /\[Book an Investment Consultation\]/);
  assert.match(appendCalendlyBookingLink('OK.', url, { force: true, language: 'other' }), /\[Book an appointment\]/);
});

test('1e: decline and meeting words in Hindi, Punjabi, Tamil, and Mandarin', () => {
  const declines = ['बाद में', 'अभी नहीं', 'नहीं, धन्यवाद', 'दस्तावेज़ बाद में भेजूँगा', 'ਬਾਅਦ ਵਿੱਚ', 'ਦਸਤਾਵੇਜ਼ ਹੁਣ ਨਹੀਂ', 'பிறகு', 'ஆவணங்கள் இப்போது வேண்டாம்', '以后', '文件以后再发', '不用了，谢谢', 'non, merci', 'لا، شكرا'];
  for (const text of declines) assert.equal(isDocumentDeclineMessage(text), true, text);
  const notDeclines = ['मुझे टोरंटो में घर चाहिए', 'ਮੈਨੂੰ ਘਰ ਚਾਹੀਦਾ ਹੈ', 'எனக்கு வீடு வேண்டும் டொராண்டோவில்', '我想在多伦多买房'];
  for (const text of notDeclines) assert.equal(isDocumentDeclineMessage(text), false, text);
  for (const text of ['मीटिंग कब हो सकती है', 'ਮੁਲਾਕਾਤ ਕਰਨੀ ਹੈ', 'சந்திப்பு வேண்டும்', '我想预约']) {
    assert.equal(userSignalsBookingIntent(text), true, text);
  }
  assert.equal(visitorSkipsDocumentRequest('दस्तावेज़ बाद में'), true);
  for (const pack of Object.values(VISITOR_WORDS)) {
    for (const key of ['decline', 'shortDecline', 'docs', 'meeting']) assert.ok(pack[key]?.length, key);
  }
});

test('1f: pause copy is localized and Arabic ؟ questions are held like ? questions', () => {
  assert.equal(holdFurtherQuestions('ما هي ميزانيتك؟', 'لاحقا', 'arabic'), PAUSE_COPY.arabic.later);
  assert.equal(holdFurtherQuestions('आपका बजट क्या है?', 'बाद में', 'hindi'), PAUSE_COPY.hindi.later);
  assert.equal(holdFurtherQuestions('The price is $3.5M. What is your timeline?', 'later'), 'The price is $3.5M.');
});

test('1g: the strings live in one table, not scattered across files', () => {
  const style = src('../services/professionalAssistant/replyStyle.js');
  const booking = src('../services/chat/utils/chatBookingReply.js');
  assert.doesNotMatch(style, /const (TURN_FALLBACK|INVESTOR_REFINEMENT_QUESTION|INVESTOR_STRATEGY_CONFIRM_QUESTION|INVESTOR_OPENING_QUESTION) = \{/);
  assert.doesNotMatch(booking, /const (BOOKING_COPY|PAUSE_COPY) = \{/);
  assert.doesNotMatch(booking, /plus tard\|/);
});

test('1h: investor document names exist in every document language', () => {
  for (const language of ['mandarin', 'cantonese', 'arabic', 'hindi', 'punjabi', 'tamil']) {
    for (const id of ['entity_documents', 'lease_agreements']) {
      assert.notEqual(localizedDocumentName(id, language), localizedDocumentName(id, 'english'), `${id} ${language}`);
    }
  }
});

// 2. Lawyer company documents for existing accounts
const OLD_DEFAULT = ['purchase_agreement', 'title_deed', 'mortgage_commitment', 'photo_id', 'condo_status'];

test('2a: an unstamped exact prior default list gets company documents (any order)', () => {
  const upgraded = sanitizeAssistant({ applied: true, document_requests: [...OLD_DEFAULT].reverse() }, 'lawyer');
  assert.ok(upgraded.document_requests.includes('entity_documents'));
  assert.equal(upgraded.document_catalog_version, DOCUMENT_CATALOG_VERSION);
  assert.deepEqual(upgradeLegacyDocumentRequests('lawyer', OLD_DEFAULT), [...OLD_DEFAULT, 'entity_documents']);
});

test('2b: curated subsets, stamped saves, other roles, and docs-off are left alone', () => {
  const subset = ['purchase_agreement', 'photo_id'];
  assert.deepEqual(sanitizeAssistant({ applied: true, document_requests: subset }, 'lawyer').document_requests, subset);
  // A saved (stamped) list equal to the old default means the lawyer unticked company documents on purpose.
  const stamped = sanitizeAssistant({ applied: true, document_requests: OLD_DEFAULT, document_catalog_version: DOCUMENT_CATALOG_VERSION }, 'lawyer');
  assert.deepEqual(stamped.document_requests, OLD_DEFAULT);
  assert.deepEqual(sanitizeAssistant({ applied: true, document_requests: [] }, 'lawyer').document_requests, []);
  assert.deepEqual(upgradeLegacyDocumentRequests('agent', ['proof_of_funds']), ['proof_of_funds']);
  // The save path stamps the version, so a deliberate untick survives the next read.
  assert.match(src('../services/professionalAssistant/assistantStore.js'), /document_catalog_version: DOCUMENT_CATALOG_VERSION/);
});

// 3. Test My AI preview
const profile = { full_name: 'Ada Counsel', location: 'Ottawa' };
const lawyerSetting = (clientType = '') => ({ ...sanitizeAssistant({ applied: true, languages: ['english'] }, 'lawyer'), ...(clientType ? { client_type: clientType } : {}) });

test('3a: preview signals from the persona and from chat text', () => {
  assert.deepEqual(previewIntakeSignals('lawyer', 'Hello', 'investor'), { client_type: 'investor' });
  assert.deepEqual(
    previewIntakeSignals('lawyer', 'I am buying a rental property in Austin, Texas through my LLC', ''),
    { client_type: 'investor', via_company: 'company', market_country: 'US', market_region: 'TX' },
  );
  assert.deepEqual(previewIntakeSignals('lawyer', 'Closing in Toronto, Ontario', ''), { market_country: 'CA', market_region: 'ON' });
  assert.equal(previewIntakeSignals('lawyer', 'Hello', ''), null);
  assert.equal(previewIntakeSignals('lawyer', 'investment property', 'seller'), null);
  assert.equal(previewIntakeSignals('agent', 'investor', 'investor'), null);
  assert.equal(previewIntakeSignals('mortgage_broker', 'DSCR loan for a duplex', '').client_type, 'investor');
});

test('3b: lawyer preview shows the investor and market blocks; live chat is unchanged', () => {
  const signals = previewIntakeSignals('lawyer', 'rental property in Austin, Texas through my company', '');
  const preview = buildLawyerSystemPrompt(profile, { assistantSetting: lawyerSetting('investor'), previewConversation: true, previewSignals: signals, leadGrade: 'hot' });
  assert.match(preview, /INVESTOR CLIENT/);
  assert.match(preview, /Already said in this chat: purchasing through a company/);
  assert.match(preview, /LEGAL MARKET \(Texas, United States\)/);
  assert.match(preview, /Investment closing consultation/);
  const plainPreview = buildLawyerSystemPrompt(profile, { assistantSetting: lawyerSetting(), previewConversation: true, previewSignals: null });
  assert.doesNotMatch(plainPreview, /INVESTOR CLIENT|LEGAL MARKET/);
  // Live chat ignores previewSignals and keeps reading the intake form.
  const live = buildLawyerSystemPrompt(profile, { assistantSetting: lawyerSetting(), previewSignals: signals, intakeFormContact: { address: 'Ottawa, ON', market_country: 'CA' } });
  assert.doesNotMatch(live, /INVESTOR CLIENT|said in this chat/);
  assert.match(live, /LEGAL MARKET \(Ontario, Canada\)/);
});

test('3c: broker preview shows the investor financing block from the persona', () => {
  const setting = { ...sanitizeAssistant({ applied: true, languages: ['english'] }, 'mortgage_broker'), client_type: 'investor' };
  const preview = buildMortgageBrokerSystemPrompt(profile, {
    assistantSetting: setting, previewConversation: true, previewSignals: previewIntakeSignals('mortgage_broker', 'Austin, Texas', 'investor'),
  });
  assert.match(preview, /INVESTOR FINANCING/);
  assert.match(preview, /Market: United States/);
  const live = buildMortgageBrokerSystemPrompt(profile, { assistantSetting: setting, previewSignals: { client_type: 'investor' } });
  assert.doesNotMatch(live, /INVESTOR FINANCING/);
});

test('3d: chat turn wires preview signals only for the owner preview', () => {
  const prepare = src('../services/chat/handleChat/chatTurnPrepare.js');
  assert.match(prepare, /if \(previewForOwner\) \{\n\s+systemPromptOptions\.previewSignals/);
});
