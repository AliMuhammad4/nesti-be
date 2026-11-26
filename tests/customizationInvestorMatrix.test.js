/**
 * Customization x investor matrix: agent, lawyer, and mortgage broker, buyer baseline vs investor.
 * Covers prompt blocks (custom guidance, CTA, docs wording, investor blocks, property matches off), action flows
 * and checklists, reply finishing (emoji off, language, booking copy), docs-off, and template-limited lawyer forms.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeAssistant, settingForClientType } from '../services/professionalAssistant/assistantSettings.js';
import { buildAgentSystemPrompt } from '../services/chat/prompts/agentPrompt.js';
import { buildLawyerSystemPrompt } from '../services/chat/prompts/lawyerPrompt.js';
import { buildMortgageBrokerSystemPrompt } from '../services/chat/prompts/mortgageBrokerPrompt.js';
import { getAgentActionFlow } from '../services/chat/config/agentActionFlow.js';
import { getLawyerActionFlow } from '../services/chat/config/lawyerActionFlow.js';
import { getMortgageBrokerActionFlow } from '../services/chat/config/mortgageBrokerActionFlow.js';
import { getPostBookingChecklistForMeta, getPostBookingChecklistForPrompt } from '../services/chat/flows/flowRoleMeta.js';
import { suggestedNextAction } from '../services/chat/handleChat/previewLeadSummary.js';
import { actionFlowContextFromForm, lawyerDocumentContextFromForm, lawyerInvestorPromptBlock } from '../services/professionalAssistant/brokerInvestorMarket.js';
import { applyAgentOpeningFunnel, turnFallbackReply } from '../services/professionalAssistant/replyStyle.js';
import {
  appendCalendlyBookingLink,
  isDocumentDeclineMessage,
  offerConsultationAfterSkippedUpload,
  userSignalsBookingIntent,
} from '../services/chat/utils/chatBookingReply.js';
import { nextDocumentRequest } from '../services/chat/documents/chatDocumentService.js';
import { finishLawyerReply } from '../services/professionalAssistant/lawyerReply.js';
import { finishBrokerReply } from '../services/professionalAssistant/brokerReply.js';
import { finishAgentReply } from '../services/professionalAssistant/assistantEmoji.js';

const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const profile = { full_name: 'Sam Pro', location: 'Toronto' };
const ROLES = ['agent', 'lawyer', 'mortgage_broker'];
const CLIENTS = ['buyer', 'investor'];
const GUIDANCE = 'Mention the quarterly market letter once.';

const FORMS = {
  agent: {
    buyer: { intent: 'buy', client_type: 'buyer', location: 'Toronto' },
    investor: { intent: 'buy', client_type: 'investor', location: 'Toronto', investment_type: 'long_term_rental' },
  },
  lawyer: {
    buyer: { address: 'Toronto, ON', market_country: 'CA', market_region: 'ON', client_type: 'personal' },
    investor: { address: 'Austin, TX', market_country: 'US', market_region: 'TX', client_type: 'investor', via_company: 'company' },
  },
  mortgage_broker: {
    buyer: { address: 'Calgary, AB', market_country: 'CA', market_region: 'AB', purchase_purpose: 'first_home' },
    investor: { address: 'Austin, TX', market_country: 'US', market_region: 'TX', purchase_purpose: 'investment', client_type: 'investor' },
  },
};

function setting(role, clientType, overrides = {}) {
  const base = sanitizeAssistant({
    applied: true,
    personalities: ['consultative'],
    languages: ['english'],
    use_emojis: false,
    suggest_consultation: true,
    custom_guidance: GUIDANCE,
    client_types: ['buyer', 'seller', 'investor'],
    next_actions: ['schedule', 'notify', 'save_lead'],
    ...overrides,
  }, role);
  return settingForClientType(base, clientType);
}

function prompt(role, clientType, options = {}) {
  const build = role === 'agent' ? buildAgentSystemPrompt : role === 'lawyer' ? buildLawyerSystemPrompt : buildMortgageBrokerSystemPrompt;
  return build(profile, {
    assistantSetting: setting(role, clientType, options.overrides),
    intakeFormContact: FORMS[role][clientType],
    clientType,
    leadGrade: 'hot',
    intent: 'buy',
    isAutomatedBookingEnabled: true,
    calendlyLink: 'https://calendly.com/pro/intro',
    contactKnown: true,
    propertyMatchesEnabled: options.propertyMatchesEnabled ?? true,
  });
}

for (const role of ROLES) {
  for (const clientType of CLIENTS) {
    test(`matrix prompt ${role} x ${clientType}: custom guidance, CTA, and docs wording`, () => {
      const text = prompt(role, clientType);
      assert.match(text, /Professional-approved assistant settings/);
      assert.ok(text.includes(GUIDANCE), 'custom_guidance reaches the prompt');
      const cta = setting(role, clientType).cta_label;
      assert.ok(cta && text.includes(cta), `CTA label ${cta} reaches the prompt`);
      // U.S. W-2 / NOA wording belongs to the mortgage broker only.
      if (role === 'mortgage_broker') assert.match(text, /W-2s, or 1099s may be relevant/);
      else assert.doesNotMatch(text, /W-2s, or 1099s may be relevant/);
      if (role === 'lawyer') {
        if (clientType === 'investor') {
          assert.match(text, /INVESTOR CLIENT/);
          assert.match(text, /LLC or corporation/);
          assert.match(text, /Investment closing consultation/);
          assert.doesNotMatch(text, /First Time Buyer Legal Guide/);
        } else {
          assert.doesNotMatch(text, /INVESTOR CLIENT/);
        }
      }
      if (role === 'agent' && clientType === 'investor') {
        assert.match(text, /Goal: Get them into an investment strategy call or deal review/);
        assert.doesNotMatch(text, /Goal: Get them into a showing or strategy call/);
        assert.doesNotMatch(text, /Prioritize recommending: Buyer Consultation/);
      }
    });
  }
}

test('matrix: docs off removes the documents line for every role and client type', () => {
  for (const role of ROLES) {
    for (const clientType of CLIENTS) {
      const text = prompt(role, clientType, { overrides: { document_requests: [] } });
      assert.doesNotMatch(text, /collects for this visitor, in order/, `${role} ${clientType}`);
      const s = setting(role, clientType, { document_requests: [] });
      assert.equal(nextDocumentRequest(s, [], { intent: 'buy', clientType }), null);
    }
  }
});

test('matrix: agent overlay never promises cards when property matches are off', () => {
  for (const clientType of CLIENTS) {
    const off = prompt('agent', clientType, { propertyMatchesEnabled: false });
    assert.match(off, /Property match cards are turned off for this assistant/);
    assert.doesNotMatch(off, /Property matches appear only as chat cards; when they ask/);
    const on = prompt('agent', clientType);
    assert.doesNotMatch(on, /Property match cards are turned off/);
  }
});

test('action flows: investor wording per role, tier labels and automation keys unchanged', () => {
  for (const grade of ['hot', 'warm', 'cold']) {
    const buyer = getAgentActionFlow(grade, 'buy');
    const investor = getAgentActionFlow(grade, 'buy', { clientType: 'investor' });
    assert.equal(investor.tierLabel, buyer.tierLabel);
    assert.deepEqual(investor.postBookingAutomations, buyer.postBookingAutomations);
    assert.notEqual(investor.goal, buyer.goal);
    assert.ok(investor.calendlyOptions.every((option) => !/First Time Buyer|Home Buying/.test(option)));
    // A seller never gets investor wording.
    assert.deepEqual(getAgentActionFlow(grade, 'sell', { clientType: 'investor' }).goal, getAgentActionFlow(grade, 'sell').goal);

    const lawyerBuyer = getLawyerActionFlow(grade);
    const lawyerInvestor = getLawyerActionFlow(grade, { clientType: 'investor', market: 'US' });
    assert.equal(lawyerInvestor.tierLabel, lawyerBuyer.tierLabel);
    assert.deepEqual(lawyerInvestor.postBookingAutomations, lawyerBuyer.postBookingAutomations);
    assert.match(lawyerInvestor.goal, /Investment/);
    assert.ok(lawyerInvestor.calendlyOptions.every((option) => !/First Time Buyer/.test(option)));
    assert.ok(lawyerInvestor.postBookingChatChecklist.join(' ').match(/company/));
  }
  assert.deepEqual(getLawyerActionFlow('hot', { market: 'CA' }), getLawyerActionFlow('hot'));
  assert.match(getLawyerActionFlow('hot', { market: 'US' }).postBookingChatChecklist.join(' '), /purchase agreement/);
  assert.doesNotMatch(getLawyerActionFlow('hot', { market: 'US' }).postBookingChatChecklist.join(' '), /agreement of purchase and sale/);
  assert.match(getLawyerActionFlow('hot', { clientType: 'investor', market: 'CA' }).postBookingChatChecklist.join(' '), /corporate documents/);
  assert.match(getMortgageBrokerActionFlow('hot', { clientType: 'investor', market: 'US' }).goal, /Investment/);
});

test('action-flow context is one source for every role', () => {
  assert.deepEqual(actionFlowContextFromForm('lawyer', FORMS.lawyer.investor), { clientType: 'investor', market: 'US' });
  assert.deepEqual(actionFlowContextFromForm('lawyer', FORMS.lawyer.buyer), { clientType: '', market: 'CA' });
  assert.deepEqual(actionFlowContextFromForm('mortgage_broker', FORMS.mortgage_broker.investor), { clientType: 'investor', market: 'US' });
  assert.deepEqual(actionFlowContextFromForm('agent', { motivation_reason: 'investment' }), { clientType: 'investor' });
  assert.deepEqual(actionFlowContextFromForm('agent', {}, 'investor'), { clientType: 'investor' });
  assert.deepEqual(actionFlowContextFromForm('agent', FORMS.agent.buyer), { clientType: '' });
});

test('post-booking checklist (prompt and meta) and lead next action follow the investor form', () => {
  const lawyerFlow = { flowRole: 'lawyer' };
  const agentFlow = { flowRole: 'agent' };
  const promptList = getPostBookingChecklistForPrompt(lawyerFlow, 'hot', 'buy', FORMS.lawyer.investor);
  const metaList = getPostBookingChecklistForMeta(lawyerFlow, 'hot', 'buy', FORMS.lawyer.investor);
  assert.deepEqual(promptList, metaList);
  assert.match(promptList.join(' '), /LLC or corporation documents/);
  assert.match(getPostBookingChecklistForMeta(agentFlow, 'warm', 'buy', FORMS.agent.investor).join(' '), /investment/i);
  assert.doesNotMatch(getPostBookingChecklistForMeta(agentFlow, 'warm', 'buy', FORMS.agent.buyer).join(' '), /investment alerts/i);

  assert.match(suggestedNextAction('lawyer', 'hot', 'buy', '', 0, { clientType: 'investor' }).goal, /Investment closing/);
  assert.match(suggestedNextAction('agent', 'warm', 'buy', '', 0, { clientType: 'investor' }).goal, /Investment strategy/);
  assert.equal(suggestedNextAction('agent', 'warm', 'buy', '', 0).goal, getAgentActionFlow('warm', 'buy').goal);
});

test('lawyer investor block: only for investors, no tax or structuring advice', () => {
  assert.equal(lawyerInvestorPromptBlock(FORMS.lawyer.buyer), '');
  const block = lawyerInvestorPromptBlock(FORMS.lawyer.investor);
  assert.match(block, /purchasing through a company/);
  assert.match(block, /Do not give tax, structuring, or investment advice/);
  assert.match(block, /Never ask first-time-buyer questions/);
  assert.doesNotMatch(block, /\d+%/);
});

test('lawyer documents: company documents only for a company purchase, after photo ID', () => {
  const s = setting('lawyer', 'investor', { document_requests: ['purchase_agreement', 'photo_id', 'entity_documents', 'title_deed'] });
  const company = { intent: 'buy', clientType: 'investor', ...lawyerDocumentContextFromForm(FORMS.lawyer.investor) };
  const personal = { intent: 'buy', clientType: 'investor', ...lawyerDocumentContextFromForm({ ...FORMS.lawyer.investor, via_company: 'personally' }) };
  assert.equal(nextDocumentRequest(s, [], company, ['purchase_agreement', 'photo_id']).id, 'entity_documents');
  assert.equal(nextDocumentRequest(s, [], personal, ['purchase_agreement', 'photo_id']).id, 'title_deed');
});

test('opening funnel: a non-English investor with a known goal never gets the buyer funnel', () => {
  const base = { isOpeningFormTurn: true, flowRole: 'agent', isInvestorVisitor: true, investmentGoalKnown: true };
  for (const [language, pattern] of [['french', /prix d’achat/], ['spanish', /precio de compra/], ['arabic', /سعر الشراء/]]) {
    const s = { applied: true, languages: [language], auto_detect_language: false };
    const out = applyAgentOpeningFunnel('Merci.', { ...base, setting: s });
    assert.match(out, pattern, language);
    assert.doesNotMatch(out, /quartiers|barrios|الأحياء|neighbou?rhood/);
  }
  // A language without investor copy ('other') keeps the model reply rather than switching to the buyer funnel.
  const other = { applied: true, languages: ['other'], auto_detect_language: false };
  assert.equal(applyAgentOpeningFunnel('Merci.', { ...base, setting: other }), 'Merci.');
  const conflict = applyAgentOpeningFunnel('Gracias.', {
    ...base, strategyGoalConflict: true, setting: { applied: true, languages: ['spanish'], auto_detect_language: false },
  });
  assert.match(conflict, /reventa/);
});

test('booking copy follows the reply language; custom CTA label always wins', () => {
  const url = 'https://calendly.com/pro/intro';
  const fr = offerConsultationAfterSkippedUpload('D’accord.', url, { allowSchedule: true, language: 'french' });
  assert.match(fr, /Vous pouvez envoyer les documents/);
  assert.match(fr, /\[Prendre rendez-vous\]\(https:\/\/calendly\.com\/pro\/intro\)/);
  assert.doesNotMatch(fr, /You can send|Book an appointment/);
  const es = offerConsultationAfterSkippedUpload('De acuerdo.', url, { allowSchedule: true, language: 'spanish', label: 'Book an Investment Consultation' });
  assert.match(es, /\[Book an Investment Consultation\]/);
  const blocked = offerConsultationAfterSkippedUpload('D’accord.', url, { allowSchedule: false, language: 'french' });
  assert.doesNotMatch(blocked, /calendly/);
  assert.match(blocked, /Vous pouvez envoyer/);
  const en = appendCalendlyBookingLink('Sure.', url, { userMessage: 'can we book a call', language: 'english' });
  assert.match(en, /\[Book an appointment\]/);
});

test('document decline and meeting asks in French, Spanish, and Arabic', () => {
  for (const text of ['plus tard pour les documents', 'Non merci', 'más tarde', 'no gracias, los documentos después', 'لاحقا']) {
    assert.equal(isDocumentDeclineMessage(text), true, text);
  }
  for (const text of ['Je cherche à Montréal', 'Quiero invertir en Miami', 'أريد شقة']) {
    assert.equal(isDocumentDeclineMessage(text), false, text);
  }
  for (const text of ['Je veux prendre rendez-vous', 'Quiero una cita', 'أريد موعد']) {
    assert.equal(userSignalsBookingIntent(text), true, text);
  }
});

test('fixed fallback lines are localized or empty (never English in a French chat)', () => {
  for (const key of ['matchesOff', 'needContact', 'clientTypeBlocked', 'skipListings', 'skipListingsInvestor']) {
    for (const language of ['english', 'french', 'spanish', 'arabic']) {
      assert.ok(turnFallbackReply(key, language), `${key} ${language}`);
    }
    assert.equal(turnFallbackReply(key, 'other'), '');
  }
  const finish = src('../services/chat/handleChat/chatTurnFinish.js');
  assert.doesNotMatch(finish, /'No problem — we can skip those listings/);
  assert.doesNotMatch(finish, /'This assistant is not set up for that client type/);
  assert.match(finish, /language: turnLanguage/);
});

test('emoji off strips emojis on every role finisher for buyer and investor turns', () => {
  const s = (role) => ({ applied: true, role, use_emojis: false, languages: ['english'], personalities: ['consultative'] });
  const reply = 'Thanks for the details 😊 When is the closing date?';
  assert.doesNotMatch(finishLawyerReply(reply, { setting: s('lawyer'), userMessage: 'I am buying through my company' }), /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(finishBrokerReply(reply, { setting: s('mortgage_broker'), userMessage: 'investment property' }), /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(finishAgentReply(reply, { setting: s('agent'), userMessage: 'rental income' }), /\p{Extended_Pictographic}/u);
});

test('lawyer form: final submit uses the same template-limited required fields as the form', () => {
  const strategy = src('../../frontend/src/components/chatbot/widget/roleChatStrategy.js');
  assert.match(strategy, /export function lawyerRequiredForDraft\(draft, \{ requireClientType = false, enabledQuestionIds = null \} = \{\}\)/);
  assert.match(strategy, /transaction_type: \["transaction_type"\]/);
  const widget = src('../../frontend/src/components/chatbot/ChatWidget.js');
  assert.match(widget, /lawyerRequiredForDraft\(rolePreflightDraft, \{ requireClientType: allowInvestor, enabledQuestionIds \}\)/);
});
