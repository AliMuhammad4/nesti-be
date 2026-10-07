import crypto from 'crypto';
import EnterpriseInquiry from '../../../models/EnterpriseInquiry.js';
import ChatbotEmbedUrl from '../../../models/ChatbotEmbedUrl.js';
import { runChatOpenAiTurn } from '../handleChat/chatOpenAiTurn.js';
import {
  allowLandingChatRate,
  isLandingEmbed,
  loadLandingChatSettings,
} from './landingChatConfig.js';
import { asksHowNestiIsDifferent, cleanLandingReply, landingRoleReply, nestiLandingFlow, replyIsUsable, replyWithoutVisitorName, scoreLandingLead, shortenLandingReply } from './nestiLandingFlow.js';
import { agreesToWalkthrough, askedForWalkthrough, detectPain, mentionsPricing, painById, roleFallbackQuestion } from './landingPainPoints.js';
import { appendChatEvents, nextChatState, questionFromReply, readChatState } from './landingChatState.js';
import { notifyAdminsOfAdminLead } from './notifyAdminsOfLandingLead.js';
import { queueAdminLeadFollowUp } from '../../admin/adminLeadGuideEmailService.js';
import { nextAutoPipelineStage } from '../../admin/adminPipelineStage.js';

function text(value) {
  return String(value || '').trim();
}

function visibleReply(value) {
  return String(value || '').split('###META###')[0].trim();
}

function isHiddenOpening(value) {
  const raw = text(value);
  return raw.startsWith('My name, email, and mobile are already saved')
    || (raw.startsWith('This is ') && raw.includes('Greet them by name as Ravi'));
}

async function saveAdminLead({ sessionId, contact, audience, spoken, reply, score, grade, skipUser = false, chatState, chatEvents }) {
  const email = text(contact.email).toLowerCase();
  const phone = text(contact.phone);
  const name = text(contact.name);
  let inquiry = sessionId
    ? await EnterpriseInquiry.findOne({ session_id: sessionId, source: 'landing_chat' })
    : null;
  if (!inquiry && email) {
    inquiry = await EnterpriseInquiry.findOne({ email, source: 'landing_chat' });
  }
  const turns = [
    ...(!skipUser && spoken ? [{ role: 'user', text: spoken.slice(0, 2000), at: new Date() }] : []),
    { role: 'assistant', text: reply.slice(0, 4000), at: new Date() },
  ];
  if (!inquiry) {
    inquiry = await EnterpriseInquiry.create({
      email,
      phone,
      full_name: name,
      company_name: name || 'Homepage chat',
      interest_role: audience,
      source: 'landing_chat',
      message: skipUser ? 'Started a homepage chat with Ravi.' : spoken.slice(0, 2000),
      status: skipUser ? 'pending' : 'contacted',
      pipeline_stage: skipUser ? 'new' : 'calling',
      session_id: sessionId,
      lead_score: score,
      lead_grade: grade,
      transcript: turns,
      chat_state: chatState,
      chat_events: chatEvents,
    });
    await notifyAdminsOfAdminLead({ inquiry }).catch(() => {});
    queueAdminLeadFollowUp(inquiry._id);
    return inquiry;
  }
  inquiry.email = email || inquiry.email;
  inquiry.phone = phone || inquiry.phone;
  inquiry.full_name = name || inquiry.full_name;
  inquiry.interest_role = audience || inquiry.interest_role;
  if (!skipUser) inquiry.message = spoken.slice(0, 2000);
  inquiry.session_id = inquiry.session_id || sessionId;
  inquiry.lead_score = score;
  inquiry.lead_grade = grade;
  inquiry.transcript = [...(inquiry.transcript || []), ...turns].slice(-24);
  if (chatState) inquiry.chat_state = chatState;
  if (chatEvents) inquiry.chat_events = chatEvents;
  inquiry.pipeline_stage = nextAutoPipelineStage(inquiry);
  if (inquiry.pipeline_stage === 'calling' && inquiry.status === 'pending') inquiry.status = 'contacted';
  await inquiry.save();
  if (!skipUser) queueAdminLeadFollowUp(inquiry._id);
  return inquiry;
}

export async function handleLandingChatTurn({
  message,
  embedToken,
  sessionId,
  visitorId,
  clientIp,
  formContact = {},
  opening = false,
}) {
  const spoken = text(message);
  if (!spoken) return { status: 400, body: { success: false, message: 'message is required' } };
  if (!embedToken) return { status: 400, body: { success: false, message: 'embedToken is required' } };
  if (spoken.length > 4000) return { status: 400, body: { success: false, message: 'message is too long' } };

  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken }).lean();
  if (!embed || !isLandingEmbed(embed)) {
    return { status: 403, body: { success: false, message: 'This chat is only for the homepage guide.' } };
  }
  if (!allowLandingChatRate(clientIp, visitorId)) {
    return { status: 429, body: { success: false, message: 'Too many messages. Try again in a minute.' } };
  }
  const settings = await loadLandingChatSettings().catch(() => null);
  if (settings && settings.enabled === false) {
    return { status: 403, body: { success: false, message: 'Landing chat is turned off.' } };
  }

  const sid = text(sessionId) || crypto.randomBytes(8).toString('hex');
  const contact = {
    name: text(formContact.name),
    email: text(formContact.email).toLowerCase(),
    phone: text(formContact.phone),
  };
  const audience = text(formContact.audience_role) || 'client';
  const prior = sid
    ? await EnterpriseInquiry.findOne({ session_id: sid, source: 'landing_chat' }).select('transcript chat_state chat_events').lean()
    : null;
  const history = (prior?.transcript || []).slice(-8).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: text(item.text),
  })).filter((item) => item.content);
  const state = readChatState(prior);
  const greeting = Boolean(opening) || history.length === 0;
  const lastAssistant = [...(prior?.transcript || [])].reverse().find((item) => item.role === 'assistant');
  const walkthrough = !greeting && agreesToWalkthrough(spoken) && askedForWalkthrough(lastAssistant?.text);
  const detected = greeting ? null : detectPain(audience, spoken);
  const pain = detected || painById(audience, state.pain_point);
  const guides = settings || {};
  const scored = scoreLandingLead({
    message: spoken,
    hasContact: Boolean(contact.email || contact.phone || contact.name),
    contactInfo: contact,
    interactionCount: history.length + 1,
  });
  const system = nestiLandingFlow.buildSystemPrompt(null, {
    audience,
    landingGuides: { ...guides, signup_cta_copy: guides.signup_cta_copy },
    contactKnown: Boolean(contact.name && contact.email && contact.phone),
    visitorName: contact.name,
    opening: greeting,
    pain: greeting ? null : pain,
    featuresExplained: state.features_explained,
    questionsAsked: state.questions_asked,
    walkthrough,
  });
  const openaiMessages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: spoken },
  ];
  let reply = '';
  let failed = false;
  if (!greeting && asksHowNestiIsDifferent(spoken) && !detected) {
    reply = landingRoleReply(audience);
  } else {
    try {
      const turn = await runChatOpenAiTurn({
        openaiMessages,
        sessionId: sid,
        flow: nestiLandingFlow,
        formQualification: {},
        seedSignals: {},
        conversationText: spoken,
        hasContact: Boolean(contact.email || contact.phone),
        contactInfo: { ...contact },
        interactionCount: history.length + 1,
        intent: 'unspecified',
      });
      reply = cleanLandingReply(visibleReply(turn?.aiReply));
    } catch {
      failed = true;
      reply = roleFallbackQuestion(audience);
    }
  }
  if (!failed && !replyIsUsable(reply)) {
    failed = true;
    reply = roleFallbackQuestion(audience);
  }
  if (greeting) reply = reply.replace(/\[\[plans\]\]/gi, '').trim();
  if (!greeting) reply = replyWithoutVisitorName(reply, contact.name);
  reply = shortenLandingReply(reply, { greeting, feature: failed ? '' : pain?.feature || '' }) || roleFallbackQuestion(audience);
  const featureUsed = greeting || failed ? '' : (pain?.feature || '');
  const chatState = nextChatState(state, {
    pain: detected || pain,
    feature: featureUsed,
    question: questionFromReply(reply),
  });
  const chatEvents = appendChatEvents(prior?.chat_events, [
    !prior ? { type: 'role_selected', detail: audience } : null,
    detected ? { type: 'pain_detected', detail: detected.id } : null,
    featureUsed ? { type: 'feature_discussed', detail: featureUsed } : null,
    !greeting && mentionsPricing(spoken) ? { type: 'pricing_mentioned', detail: 'pricing' } : null,
    { type: 'turn', detail: String(chatState.turns) },
  ]);
  const inquiry = await saveAdminLead({
    sessionId: sid,
    contact,
    audience,
    spoken,
    reply,
    score: scored.leadScore,
    grade: scored.leadGrade,
    skipUser: Boolean(opening),
    chatState,
    chatEvents,
  });
  return {
    status: 200,
    body: {
      success: true,
      reply,
      session_id: sid,
      lead_id: inquiry?._id ? String(inquiry._id) : '',
    },
  };
}

export async function loadLandingChatSession({ embedToken, sessionId }) {
  if (!text(embedToken)) return { status: 400, body: { success: false, message: 'embedToken is required' } };
  if (!text(sessionId)) return { status: 400, body: { success: false, message: 'session_id is required' } };
  const embed = await ChatbotEmbedUrl.findOne({ token: text(embedToken) }).lean();
  if (!embed || !isLandingEmbed(embed)) {
    return { status: 403, body: { success: false, message: 'This chat is only for the homepage guide.' } };
  }
  const inquiry = await EnterpriseInquiry.findOne({ session_id: text(sessionId), source: 'landing_chat' }).lean();
  if (!inquiry) {
    return { status: 200, body: { success: true, found: false, messages: [] } };
  }
  const messages = (inquiry.transcript || [])
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      text: visibleReply(item.text),
    }))
    .filter((item) => item.text && !isHiddenOpening(item.text));
  return {
    status: 200,
    body: {
      success: true,
      found: messages.length > 0,
      audience: text(inquiry.interest_role),
      contact: {
        name: text(inquiry.full_name),
        email: text(inquiry.email),
        phone: text(inquiry.phone),
      },
      messages,
    },
  };
}
