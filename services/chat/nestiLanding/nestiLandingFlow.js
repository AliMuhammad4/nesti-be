import { bestGrade } from '../scoring/agentScoring.js';
import { GRADE_ORDER } from '../scoring/common.js';
import { createOrReuseLeadProfile, createValidatedLeadMatch, createValidatedLeadAttribution } from '../scoring/leadPersistence.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import { guideForAudience } from './landingChatConfig.js';
import { featurePattern } from './landingPainPoints.js';

const GRADES = ['hot', 'warm', 'interested', 'cold'];

function text(value) {
  return String(value || '').trim();
}

export function scoreLandingLead({ message, hasContact, contactInfo, interactionCount }) {
  const spoken = text(message).toLowerCase();
  let score = 8;
  const reasons = [];
  if (hasContact && (contactInfo?.email || contactInfo?.phone)) {
    score += 28;
    reasons.push('Contact details are on file.');
  }
  if (contactInfo?.name) score += 8;
  const turns = Number(interactionCount) || 0;
  score += Math.min(20, turns * 4);
  if (/\b(subscribe|subscription|sign up|signup|start|trial|demo|book)\b/.test(spoken)) {
    score += 24;
    reasons.push('They asked to start or book a next step.');
  }
  if (/\b(price|plan|cost|expensive)\b/.test(spoken)) {
    score += 8;
    reasons.push('They asked about plans.');
  }
  score = Math.max(0, Math.min(100, score));
  const leadGrade = score >= 80 ? 'hot' : score >= 60 ? 'warm' : score >= 35 ? 'interested' : 'cold';
  return {
    leadScore: score,
    leadGrade,
    leadMeta: {
      signals: {},
      qualified: Boolean(hasContact) && score >= 35,
      lead_reasons: reasons,
    },
  };
}

function clientLeadType(grade) {
  const safe = GRADES.includes(grade) ? grade : 'interested';
  return `${safe}_client`;
}

function safeVisitorName(value) {
  const name = text(value);
  if (!name || /lorem|ipsum|molestia|dolor sit|consectetur|adipiscing|eiusmod/i.test(name)) return '';
  return name;
}

export function asksHowNestiIsDifferent(value) {
  const spoken = text(value).toLowerCase();
  return /\b(different|difference|compare|comparison|stand out|versus|vs\.?)\b/.test(spoken)
    || /\b(why nesti|why choose|what makes (you|nesti)|better than)\b/.test(spoken);
}

export function replyWithoutVisitorName(value, name) {
  const who = text(name);
  let reply = text(value);
  if (who.length >= 2) {
    const escaped = who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    reply = reply
      .replace(new RegExp(`\\b(hi|hello|hey)\\s+${escaped}\\b[,!.]?\\s*`, 'gi'), '')
      .replace(new RegExp(`\\b${escaped}\\b[,]?\\s*`, 'gi'), '');
  }
  reply = reply.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  if (!reply) return '';
  return reply.charAt(0).toUpperCase() + reply.slice(1);
}

export function landingRoleReply(audience) {
  const normalized = String(audience || '').trim();
  const raw = normalized.toLowerCase();
  const key = raw.includes('lawyer')
    ? 'lawyer'
    : raw.includes('mortgage') || raw.includes('broker')
      ? 'broker'
      : raw.includes('agent') || raw.includes('realtor')
        ? 'agent'
        : 'client';

  const lines = (items) => items.map((item) => `- ${item}`).join('\n');
  if (key === 'client') {
    return `I can guide you to the right next step. Nesti helps you connect with the right agent, mortgage broker, and lawyer while keeping the journey organized from first look to close.\n${lines([
      'Progress tracking keeps the next step clear.',
      'Budget tools make the numbers easier to understand.',
      'Support stays with you as you buy or sell.',
    ])}\nWould you like to start with the match, or with how the steps are managed?`;
  }

  const role = key === 'lawyer'
    ? 'As a lawyer, the value is one organized workspace for the file, follow-up, and closing process.'
    : key === 'broker'
      ? 'As a mortgage broker, the value is one organized workspace for new inquiries, follow-up, and financing conversations.'
      : 'As an agent, the value is one organized workspace for new inquiries, follow-up, and your client experience.';
  const extra = key === 'lawyer'
    ? 'The agreement, title, lender instructions, and closing stay in one place.'
    : key === 'broker'
      ? 'Pre-approval, affordability, renewal, and first-home financing all fit in that same workspace.'
      : 'Your chatbot can live on any page, and your storefront becomes your own polished web presence.';

  return `That is a fair question, and I can walk you through it. ${role}\n${lines([
    extra,
    'Your storefront gives you a professional web presence.',
    'The voice agent helps you answer calls and follow up when you are away.',
  ])}\nWhich of these would you like to see first?`;
}

export function shortenLandingReply(value, { greeting = false, feature = '' } = {}) {
  const cleaned = cleanLandingReply(value);
  if (!cleaned) return '';
  const prose = [];
  const bullets = [];
  cleaned.split('\n').map((line) => line.trim()).filter(Boolean).forEach((line) => {
    if (/^[-•*]\s+/.test(line)) bullets.push(line.replace(/^[-•*]\s+/, '').trim());
    else prose.push(line);
  });
  const sentences = prose.join(' ').split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  let question = '';
  if (sentences.length && /\?\s*$/.test(sentences[sentences.length - 1])) question = sentences.pop();
  const hint = featurePattern(feature);
  const featureSentence = hint ? sentences.find((sentence) => hint.test(sentence)) : '';
  const recognition = sentences[0] || '';
  const kept = [];
  if (recognition) kept.push(recognition);
  if (featureSentence && featureSentence !== recognition) kept.push(featureSentence);
  else if (sentences[1] && sentences[1] !== featureSentence) kept.push(sentences[1]);
  const paragraph = greeting ? sentences.slice(0, 2).join(' ') : kept.filter(Boolean).slice(0, 2).join(' ');
  const points = greeting ? [] : bullets.slice(0, 3).filter(Boolean).map((item) => `- ${item}`);
  return [paragraph, points.join('\n'), question].filter(Boolean).join('\n');
}

export function replyIsUsable(value) {
  const cleaned = cleanLandingReply(value);
  return cleaned.length >= 12;
}

export function normalizeLandingMarkers(value) {
  let raw = text(value).replace(/\*\*|__/g, '').replace(/`+/g, '');
  raw = raw.replace(/[ \t]+(?=\d+[.)]\s+)/g, '\n');
  raw = raw.replace(/^\d+[.)]\s+/gm, '- ');
  return raw.split('\n').map((line) => {
    const trimmed = line.trim();
    const peeled = trimmed.match(/^(-\s+.+\.)\s+([A-Z][^?.]{0,140}\?)\s*$/);
    return peeled ? `${peeled[1]}\n${peeled[2]}` : trimmed;
  }).join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

export function cleanLandingReply(value) {
  return normalizeLandingMarkers(text(value)
    .replace(/\b(lorem ipsum|molestias molestiae|molestiae|molestias|consectetur adipiscing|eiusmod tempor|incididunt ut labore|dolor sit amet)\b/gi, ''))
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+([,.!?])/g, '$1')
    .trim();
}

export const nestiLandingFlow = {
  landingMode: true,
  flowRole: 'landing',
  getFormQualification: () => ({}),
  getFormSignals: () => ({}),
  scoreLead: scoreLandingLead,
  deriveQualificationFromText: () => ({}),
  bestGrade,
  getPersistedGrade: (grade) => grade,
  getIntentSuffix: () => 'client',
  getLeadClassification: (grade) => {
    const label = text(grade) || 'interested';
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} Lead`;
  },
  enhanceWithAi: (_formQualification, _parsed, formSignals) => ({
    aiEnhancedQualification: {},
    aiEnhancedSignals: formSignals || {},
  }),
  mergeSignalsForMeta: (signals) => signals || {},
  getMergedAiDetails: (parsed) => parsed || {},
  getLeadProfileUpdate: () => ({}),
  computeLeadType: (grade) => clientLeadType(grade),
  buildSystemPrompt(_profile, options = {}) {
    const rawAudience = text(options.audience) || 'client';
    const audience = rawAudience.toLowerCase().includes('lawyer')
      ? 'lawyer'
      : rawAudience.toLowerCase().includes('mortgage') || rawAudience.toLowerCase().includes('broker')
        ? 'broker'
        : rawAudience.toLowerCase().includes('agent') || rawAudience.toLowerCase().includes('realtor')
          ? 'agent'
          : 'client';
    const guides = options.landingGuides || {};
    const cta = text(guides.signup_cta_copy) || 'When they are ready, invite them once to create an account and start the plan that fits.';
    const known = options.contactKnown
      ? 'Their name, email, and mobile number are already saved. Never ask for them again. Never ask which role they are.'
      : 'If name, email, or mobile is missing, ask for the missing one only.';
    const catalog = audience === 'client' ? 'buyer and seller' : 'professional';
    const visitorName = safeVisitorName(options.visitorName);
    const roleAnswer = audience === 'client'
      ? 'This visitor is a client who is buying or selling. Answer only with that experience: a match with a real estate agent, a mortgage broker, and a real estate lawyer, plus progress tracking, budget tools, and support. Do not describe the chatbot, storefront, pipeline, email tools, or voice agent.'
      : audience === 'lawyer'
        ? 'This visitor is a real estate lawyer. Answer only with the lawyer workspace: a chatbot they create and place on any page, a storefront that is their own web page, referrals, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent, plus the agreement, title, lender instructions, and closing. Do not describe buyer matching or budget tools.'
        : audience === 'broker'
          ? 'This visitor is a mortgage broker. Answer only with the broker workspace: a chatbot they create and place on any page, a storefront that is their own web page, referrals, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent, plus pre-approval, affordability, renewal, and first-home financing. Do not describe buyer matching or budget tools.'
          : 'This visitor is a real estate agent. Answer only with the agent workspace: a chatbot they create and place on any page, a storefront that is their own web page, referrals, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent. Do not describe buyer matching or budget tools.';
    const nameLine = options.opening
      ? (visitorName
        ? `The visitor's name is ${visitorName}. Use ${visitorName} once, in this greeting only. Never skip the name in the greeting.`
        : 'If their name is missing, greet them warmly without inventing a name.')
      : 'Do not use the visitor\'s name in this reply. Do not start with Hi, Hello, or Hey plus their name. Their name belongs only in the first greeting.';
    const pain = options.pain || null;
    const explained = Array.isArray(options.featuresExplained) ? options.featuresExplained.filter(Boolean) : [];
    const asked = Array.isArray(options.questionsAsked) ? options.questionsAsked.filter(Boolean) : [];
    const painLine = options.opening
      ? ''
      : pain
        ? `Their problem is ${pain.label}. Name that problem in the first sentence. Mention only this feature: ${pain.feature}. Do not list other services.`
        : 'You do not know their problem yet. Ask one short clarification question for this role. Do not guess a feature and do not list the catalog.';
    const memoryLine = [
      explained.length ? `Already explained: ${explained.join(', ')}. Do not explain those again.` : '',
      asked.length ? `Already asked: ${asked.join(' | ')}. Do not ask those again.` : '',
    ].filter(Boolean).join('\n');
    const serviceRule = audience === 'client'
      ? 'Client services you may mention, only when relevant: a match with an agent, a mortgage broker, and a lawyer, progress tracking, budget tools, and support. Never say you cannot explain them.'
      : 'Professional services you may mention, only when relevant: a chatbot they place on any page, a storefront that is their own web page, referrals, AI emails, nurture follow-ups, pipeline, performance tracking, autopilot, and a voice agent. Never say you cannot explain them.';
    const firstTurn = options.opening
      ? `This is your first message. Write three short sentences and nothing more. Start with "Hi ${visitorName || 'there'}, I'm Ravi." The second sentence shows warmth and empathy for their situation. The third sentence asks one gentle question about what they hope for. Do not mention plans, prices, subscriptions, or services. Do not write [[plans]]. Do not use bullets or dashes.`
      : options.walkthrough
        ? 'They agreed to a walkthrough. Write two short sentences, then at most three "- " steps for their role, then one new question. Do not list every service. Do not write [[plans]].'
        : 'On later messages, guide one step. First sentence: show you understood their problem. Second sentence: one next step, and the one feature above if a problem is known. End with one new question. Do not list every service. Put [[plans]] alone on the last line only when they ask about plans, price, cost, or starting a subscription.';
    return `You are Ravi, a calm and welcoming Nesti specialist on the public homepage. You only help with Nesti: what Nesti does for this ${audience}, the services below, and, only if they ask, how to start a subscription.
${known}
${nameLine}
${serviceRule}
${roleAnswer}
${painLine}
${memoryLine}
Questions about what Nesti does, how Nesti is different, why choose Nesti, how it compares with others, and how a service works are Nesti questions. Answer them now for this role. If they also named a problem, answer that problem instead of a general role script. Do not say you are here to focus, and do not ask permission before you explain.
Answer only Nesti questions. If they ask something unrelated to Nesti, such as general knowledge, news, or another company, do not answer that question. Reply with empathy in one short paragraph, say you are here for Nesti, and ask once if they would like you to walk them through how Nesti can help. Do not add bullets on that reply. Do not write [[plans]].
Never invent a name. Never write placeholder text, Latin filler, lorem ipsum, or words such as molestias or molestiae. Never use asterisks, bold markdown, or numbered steps like "1.". After the greeting, do not say their name again. When you give steps, each step is its own line starting with a single "- ".
A plain yes, sure, okay, or please is a walkthrough only when your previous message asked to walk them through Nesti.
Guide for this audience: ${guideForAudience(guides, audience)}
${cta}
${firstTurn}
Never write a price, a dollar amount, or the words "dollars a month". ${catalog} plan cards appear only when you write [[plans]].
Ask one new question that moves them one step forward. Do not repeat a question you already asked, the welcome, or a point you already gave. Do not ask about bedrooms, listings, or a property search. Do not say the purchase is complete. Do not read a web address. English is the default.
End every reply with ###META###{"intent":"unspecified","emotional_state":"neutral","contact":{},"details":{}}`;
  },
  createNewLead: async (params) => {
    const {
      conversation,
      leadScore,
      leadGrade,
      sessionId,
      embedToken,
      clientIp,
      userAgent,
      referer,
      contactInfo,
      userId,
      messageSnippet,
      formContact,
    } = params;
    const audience = text(formContact?.audience_role) || 'client';
    const { leadProfile } = await createOrReuseLeadProfile({
      payload: {
        identity: {
          full_name: text(contactInfo?.name),
          email: text(contactInfo?.email).toLowerCase(),
          phone: text(contactInfo?.phone),
        },
        intent: 'unspecified',
        intent_summary: { primary_intent: 'client' },
        source: 'landing_chat',
        total_score: leadScore,
      },
      userId,
      professionalType: PROFESSIONAL_TYPE.AGENT,
      contactInfo,
      leadGrade,
    });
    const now = new Date();
    const leadMatch = await createValidatedLeadMatch({
      user_id: userId,
      professional_profile_id: params.professionalProfileId || undefined,
      conversation_id: conversation._id,
      lead_type: clientLeadType(leadGrade),
      lead_profile_id: leadProfile._id,
      match_score: leadScore,
      match_status: 'new',
      contact_count: 1,
      first_contact_at: now,
      last_contact_at: now,
      compatibility_factors: {
        session_id: sessionId,
        embed_token: embedToken,
        source: 'landing_chat',
        audience_role: audience,
        page_path: '/',
        lead_grade: leadGrade,
        message_snippet: messageSnippet,
        contact: contactInfo,
        professional_type: PROFESSIONAL_TYPE.AGENT,
      },
    });
    await createValidatedLeadAttribution({
      lead_type: clientLeadType(leadGrade),
      source: 'chatbot',
      converted: false,
      lead_profile_id: leadProfile._id,
      lead_match_id: leadMatch._id,
      session_id: sessionId,
      ip_address: clientIp || '',
      user_agent: userAgent || '',
      referrer_url: referer || '',
      initial_score: leadScore,
      initial_quality: leadGrade,
    });
    return leadMatch;
  },
};

export function landingGradeRank(grade) {
  return GRADE_ORDER[grade] || 0;
}
