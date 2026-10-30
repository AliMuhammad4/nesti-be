import crypto from 'crypto';
import EnterpriseInquiry from '../../../models/EnterpriseInquiry.js';
import ChatbotEmbedUrl from '../../../models/ChatbotEmbedUrl.js';
import { runChatOpenAiTurn } from '../handleChat/chatOpenAiTurn.js';
import {
  allowLandingChatRate,
  bindLandingChatSessionAudience,
  isLandingEmbed,
  isLandingAudience,
  landingBotIdentity,
  loadLandingChatSettingsRequired,
  applyRegister,
  personalityFor,
  formalityFor,
} from './landingChatConfig.js';
import { cleanLandingReply, enabledRoleCustomization, finishLandingSpokenReply, landingBackupTone, landingFallbackReply, landingGreetingFallback, nestiLandingFlow, replyFromSavedKnowledge, replyIsUsable, scoreLandingLead, shortenLandingReply } from './nestiLandingFlow.js';
import { agreesToWalkthrough, askedForWalkthrough, detectPain, mentionsPricing, painById, roleFallbackQuestion } from './landingPainPoints.js';
import { appendChatEvents, nextChatState, questionFromReply, readChatState } from './landingChatState.js';
import { notifyAdminsOfAdminLead } from './notifyAdminsOfLandingLead.js';
import { queueAdminLeadFollowUp } from '../../admin/adminLeadGuideEmailService.js';
import { nextAutoPipelineStage, reopenNurtureLead } from '../../admin/adminPipelineStage.js';

export const landingChatLeadDeps = { notifyAdminsOfAdminLead, queueAdminLeadFollowUp };

export function shouldReuseLandingInquiry(past) {
  return Boolean(past && past.close_outcome !== 'won');
}

function text(value) {
  return String(value || '').trim();
}

function visibleReply(value) {
  return String(value || '').split('###META###')[0].trim();
}

const INQUIRY_TOPICS = new Set(['demo', 'inquiry', 'support']);
const SESSION_CAPABILITY_PATTERN = /^[a-f0-9]{64}$/i;

export function isSecureLandingSessionId(value) {
  return SESSION_CAPABILITY_PATTERN.test(text(value));
}

function isHiddenOpening(value) {
  const raw = text(value);
  return raw.startsWith('My name, email, and mobile are already saved')
    || (raw.startsWith('This is ') && raw.includes('Greet them by name as Ravi'))
    || (raw.startsWith('Visitor ') && /Greet them now\.?$/.test(raw));
}

function inquiryTopic(value) {
  const raw = text(value).toLowerCase();
  return INQUIRY_TOPICS.has(raw) ? raw : '';
}

function readContact(formContact = {}) {
  return {
    name: text(formContact.name),
    email: text(formContact.email).toLowerCase(),
    phone: text(formContact.phone),
    company: text(formContact.company_name || formContact.company).slice(0, 160),
    city: text(formContact.city).slice(0, 120),
    country: text(formContact.country).slice(0, 80),
    topic: inquiryTopic(formContact.inquiry_topic || formContact.topic),
    preferred_contact: ['email', 'phone', 'either'].includes(text(formContact.preferred_contact).toLowerCase())
      ? text(formContact.preferred_contact).toLowerCase()
      : '',
  };
}

function applyLeadProfile(inquiry, contact) {
  if (contact.company) inquiry.company_name = contact.company;
  if (contact.city) inquiry.city = contact.city;
  if (contact.country) inquiry.country = contact.country;
  if (contact.topic) inquiry.inquiry_topic = contact.topic;
  if (contact.preferred_contact) inquiry.preferred_contact = contact.preferred_contact;
}

export async function saveAdminLead({ sessionId, contact, audience, spoken, reply, score, grade, skipUser = false, chatState, chatEvents, botName = 'Ravi', notify = true }) {
  const email = text(contact.email).toLowerCase();
  const phone = text(contact.phone);
  const name = text(contact.name);
  let inquiry = sessionId
    ? await EnterpriseInquiry.findOne({ session_id: sessionId, source: 'landing_chat' })
    : null;
  if (inquiry && inquiry.close_outcome === 'won') {
    inquiry = null;
  }
  if (!inquiry && email) {
    const past = await EnterpriseInquiry.findOne({ email, source: 'landing_chat' }).sort({ createdAt: -1 });
    if (shouldReuseLandingInquiry(past)) inquiry = past;
  }
  const cameBack = Boolean(inquiry && reopenNurtureLead(inquiry));
  const turns = [
    ...(!skipUser && spoken ? [{ role: 'user', text: spoken.slice(0, 2000), at: new Date() }] : []),
    { role: 'assistant', text: reply.slice(0, 4000), at: new Date() },
  ];
  if (!inquiry) {
    inquiry = await EnterpriseInquiry.create({
      email,
      phone,
      full_name: name,
      company_name: text(contact.company) || 'Homepage chat',
      city: text(contact.city),
      country: text(contact.country),
      inquiry_topic: inquiryTopic(contact.topic),
      interest_role: audience,
      source: 'landing_chat',
      message: skipUser ? `Started a homepage chat with ${botName}.` : spoken.slice(0, 2000),
      status: skipUser ? 'pending' : 'contacted',
      pipeline_stage: skipUser ? 'new' : 'calling',
      session_id: sessionId,
      lead_score: score,
      lead_grade: grade,
      preferred_contact: contact.preferred_contact || '',
      follow_up_pending: true,
      transcript: turns,
      chat_state: chatState,
      chat_events: chatEvents,
    });
    if (notify) await landingChatLeadDeps.notifyAdminsOfAdminLead({ inquiry }).catch(() => {});
    landingChatLeadDeps.queueAdminLeadFollowUp(inquiry._id);
    return inquiry;
  }
  inquiry.email = email || inquiry.email;
  inquiry.phone = phone || inquiry.phone;
  inquiry.full_name = name || inquiry.full_name;
  applyLeadProfile(inquiry, contact);
  inquiry.interest_role = audience || inquiry.interest_role;
  if (!skipUser) inquiry.message = spoken.slice(0, 2000);
  inquiry.session_id = sessionId;
  inquiry.lead_score = score;
  inquiry.lead_grade = grade;
  inquiry.transcript = [...(inquiry.transcript || []), ...turns].slice(-100);
  if (chatState) inquiry.chat_state = chatState;
  if (chatEvents) inquiry.chat_events = chatEvents;
  inquiry.follow_up_pending = true;
  inquiry.pipeline_stage = nextAutoPipelineStage(inquiry);
  if (inquiry.pipeline_stage === 'calling' && inquiry.status === 'pending') inquiry.status = 'contacted';
  await inquiry.save();
  if (notify && cameBack) {
    await landingChatLeadDeps.notifyAdminsOfAdminLead({
      inquiry,
      title: 'Nurture lead came back',
      body: `${text(inquiry.full_name) || 'A nurture lead'} is chatting on the homepage again and is back in conversation.`,
    }).catch(() => {});
  }
  landingChatLeadDeps.queueAdminLeadFollowUp(inquiry._id);
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
  const isOpening = Boolean(opening) || isHiddenOpening(spoken);
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
  const settings = await loadLandingChatSettingsRequired();
  if (settings && settings.enabled === false) {
    return { status: 403, body: { success: false, message: 'Landing chat is turned off.' } };
  }

  const providedSessionId = text(sessionId);
  // Never look up a chat by a guessable id. Start a fresh secure session instead.
  const sid = isSecureLandingSessionId(providedSessionId)
    ? providedSessionId
    : crypto.randomBytes(32).toString('hex');
  const contact = readContact(formContact);
  const rawAudience = text(formContact.audience_role);
  if (rawAudience && !isLandingAudience(rawAudience)) {
    return { status: 400, body: { success: false, message: 'audience_role is not supported.' } };
  }
  const prior = await EnterpriseInquiry.findOne({ session_id: sid, source: 'landing_chat' })
    .select('transcript chat_state chat_events interest_role').lean();
  const legacyRole = text(prior?.interest_role).toLowerCase();
  const legacyAudience = isLandingAudience(legacyRole)
    ? legacyRole
    : ['broker', 'mortgage broker'].includes(legacyRole) ? 'mortgage_broker' : '';
  if (rawAudience && legacyAudience && rawAudience !== legacyAudience) {
    return { status: 409, body: { success: false, message: 'The audience role cannot be changed during a chat. Start a new chat to choose another role.' } };
  }
  const audienceToBind = rawAudience || legacyAudience || '';
  const sessionAudience = await bindLandingChatSessionAudience(sid, audienceToBind);
  if (!sessionAudience.matches) {
    return { status: 409, body: { success: false, message: 'The audience role cannot be changed during a chat. Start a new chat to choose another role.' } };
  }
  const audience = sessionAudience.audience;
  const guidesForContact = settings || {};
  const contactCustomization = enabledRoleCustomization(guidesForContact, audience);
  const requiredContact = new Set(['name', 'email', 'phone']);
  if ((contactCustomization?.contact_fields || []).includes('preferred_contact')) requiredContact.add('preferred_contact');
  const phoneDigits = contact.phone.replace(/\D/g, '');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email);
  const missingContact = [];
  if (requiredContact.has('name') && !contact.name) missingContact.push('name');
  if (requiredContact.has('email') && !emailOk) missingContact.push('email');
  if (requiredContact.has('phone') && phoneDigits.length < 8) missingContact.push('mobile number');
  if (requiredContact.has('preferred_contact') && !contact.preferred_contact) missingContact.push('preferred contact method');
  if (missingContact.length) {
    return { status: 400, body: { success: false, message: `${missingContact.join(', ')} ${missingContact.length === 1 ? 'is' : 'are'} required.` } };
  }
  const history = (prior?.transcript || []).slice(-8).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: text(item.text),
  })).filter((item) => item.content);
  const state = readChatState(prior);
  const greeting = isOpening || history.length === 0;
  const lastAssistant = [...(prior?.transcript || [])].reverse().find((item) => item.role === 'assistant');
  const walkthrough = !greeting && agreesToWalkthrough(spoken) && askedForWalkthrough(lastAssistant?.text);
  const detected = greeting ? null : detectPain(audience, spoken);
  const pain = detected || painById(audience, state.pain_point);
  const guides = settings || {};
  const roleCustomization = enabledRoleCustomization(guides, audience);
  const personalityKey = personalityFor(guides.personality).id;
  const formalityKey = formalityFor(guides.formality).id;
  const { botName } = landingBotIdentity(guides);
  const scored = scoreLandingLead({
    message: spoken,
    hasContact: Boolean(contact.email || contact.phone || contact.name),
    contactInfo: contact,
    interactionCount: history.length + 1,
  });
  const system = nestiLandingFlow.buildSystemPrompt(null, {
    audience,
    landingGuides: { ...guides, signup_cta_copy: guides.signup_cta_copy },
    contactKnown: [...requiredContact].every((id) => {
      if (id === 'name') return Boolean(contact.name);
      if (id === 'email') return emailOk;
      if (id === 'phone') return phoneDigits.length >= 8;
      if (id === 'preferred_contact') return Boolean(contact.preferred_contact);
      return true;
    }),
    visitorName: contact.name,
    profile: {
      company: contact.company,
      city: contact.city,
      country: contact.country,
      topic: contact.topic,
    },
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
  const cannedLandingReply = () => (
    landingFallbackReply({
      audience,
      personality: landingBackupTone(roleCustomization, personalityKey),
      formality: formalityKey,
      roleCustomization,
      message: spoken,
      previousAssistant: lastAssistant?.text,
      walkthrough,
    })
    || roleFallbackQuestion(audience, personalityKey, formalityKey)
  );
  const greetingFallback = () => {
    return landingGreetingFallback({
      visitorName: contact.name,
      botName,
      welcomeMessage: guides.welcome_message,
    });
  };
  let reply = '';
  let failed = false;
  const savedFaq = greeting ? '' : replyFromSavedKnowledge(roleCustomization, spoken);
  const useSavedOrCanned = () => {
    if (greeting) {
      return greetingFallback();
    }
    const saved = replyFromSavedKnowledge(roleCustomization, spoken);
    if (saved) return saved;
    return cannedLandingReply();
  };
  if (savedFaq) {
    reply = savedFaq;
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
      reply = useSavedOrCanned();
    }
  }
  if (!failed && !replyIsUsable(reply)) {
    failed = true;
    reply = useSavedOrCanned();
  }
  if (greeting) reply = reply.replace(/\[\[plans\]\]/gi, '').trim();
  reply = shortenLandingReply(reply, {
    greeting,
    feature: failed ? '' : pain?.feature || '',
    personality: personalityKey,
    communicationStyle: roleCustomization?.communication_style || '',
  }) || reply || roleFallbackQuestion(audience, personalityKey, formalityKey);
  reply = finishLandingSpokenReply(reply, {
    opening: greeting,
    visitorName: contact.name,
    addressByFirstName: roleCustomization?.address_by_first_name !== false,
    formality: formalityKey,
  });
  if (!text(reply)) {
    reply = applyRegister(`Tell me a little more. I am ${botName}, and I can help with the next step.`, formalityKey);
  }
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
  const leadActions = new Set(roleCustomization?.next_actions || []);
  const inquiry = leadActions.has('save_lead')
    ? await saveAdminLead({
      sessionId: sid,
      contact,
      audience,
      spoken,
      reply,
      score: scored.leadScore,
      grade: scored.leadGrade,
      skipUser: isOpening,
      chatState,
      chatEvents,
      botName,
      notify: leadActions.has('notify_admins'),
    })
    : null;
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
  if (!isSecureLandingSessionId(sessionId)) {
    return { status: 404, body: { success: false, message: 'Chat session not found.' } };
  }
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
        preferred_contact: text(inquiry.preferred_contact),
        company_name: text(inquiry.company_name) === 'Homepage chat' ? '' : text(inquiry.company_name),
        city: text(inquiry.city),
        country: text(inquiry.country),
        inquiry_topic: inquiryTopic(inquiry.inquiry_topic),
      },
      messages,
    },
  };
}
