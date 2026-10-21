import crypto from 'crypto';
import User from '../../../models/User.js';
import ChatbotEmbedUrl from '../../../models/ChatbotEmbedUrl.js';
import LandingChatSetting from '../../../models/LandingChatSetting.js';
import LandingChatSession from '../../../models/LandingChatSession.js';
import { CLIENT_PLANS } from '../../client/plans.js';
import { BILLING_PLANS } from '../../billing/plans.js';
import { LANDING_CHAT_FAQS } from './landingChatFaqs.js';
import logger from '../../../utils/logger.js';

export const LANDING_AUDIENCES = ['client', 'investor', 'agent', 'mortgage_broker', 'lawyer'];

export function isLandingAudience(value) {
  return LANDING_AUDIENCES.includes(value);
}

export const PERSONALITY_KEYS = ['friendly', 'executive', 'consultative', 'sales', 'luxury', 'caring'];
export const HOMEPAGE_QUALIFICATION_IDS = ['visitor_role', 'nesti_goal', 'location', 'timeline', 'demo_interest'];
export const LANDING_CONTACT_FIELDS = ['name', 'email', 'phone', 'preferred_contact'];
export const DEFAULT_CONTACT_FIELDS = ['name', 'email', 'phone'];
export const LANDING_NEXT_ACTIONS = ['schedule', 'collect_contact', 'notify_admins', 'callback', 'save_lead'];
export const FORMALITY_KEYS = ['formal', 'professional', 'casual'];
export const DEFAULT_BOT_NAME = 'Ravi';
export const DEFAULT_DISPLAY_NAME = 'Nesti';
export const DEFAULT_PERSONA_TITLE = '24/7 Real Estate Copilot';
export const PERSONA_ROLES = ['client', 'agent', 'broker', 'lawyer'];
export const LANDING_ROLE_CUSTOMIZATIONS = ['client', 'investor', 'agent', 'broker', 'lawyer'];
const ROLE_CUSTOMIZATION_PERSONALITIES = [
  'friendly', 'executive', 'consultative', 'sales', 'luxury', 'caring',
  'plain_language', 'real_estate_guide', 'detail_focused', 'proactive_next_step',
];
export const ROLE_CUSTOMIZATION_TONES = {
  friendly: {
    label: 'Friendly and approachable',
    guidance: 'Sound warm, welcoming, and conversational without losing accuracy.',
  },
  executive: {
    label: 'Professional and polished',
    guidance: 'Sound confident, articulate, and business-focused.',
  },
  luxury: {
    label: 'Luxury and sophisticated',
    guidance: 'Sound elegant, refined, and selective. Never invent exclusivity the visitor did not earn.',
  },
  consultative: {
    label: 'Thoughtful and consultative',
    guidance: 'Ask before recommending a next step. Understand whether the visitor is buying, selling, or working professionally.',
  },
  sales: {
    label: 'Confident and persuasive',
    guidance: 'Be proactive and help the visitor take one next step, without pressure or invented promises.',
  },
  caring: {
    label: 'Caring and supportive',
    guidance: 'Be patient, reassuring, and empathetic. Slow down when the visitor sounds unsure.',
  },
  plain_language: {
    label: 'Plain-language explainer',
    guidance: 'Explain property, mortgage, and closing terms simply; clarify uncertainty instead of guessing.',
  },
  real_estate_guide: {
    label: 'Real-estate guide',
    guidance: 'Keep guidance relevant to the visitor’s role and the stage of a property transaction.',
  },
  detail_focused: {
    label: 'Detail-focused',
    guidance: 'Be careful with dates, documents, and process details; distinguish confirmed facts from items to verify.',
  },
  proactive_next_step: {
    label: 'Proactive next step',
    guidance: 'Suggest one practical next action and ask before offering contact or follow-up.',
  },
};
const ROLE_CUSTOMIZATION_COMMUNICATION = ['quick', 'conversational', 'educational', 'consultative'];
const ROLE_CUSTOMIZATION_ACTIONS = LANDING_NEXT_ACTIONS;
const ROLE_CUSTOMIZATION_LANGUAGES = [
  'english', 'french', 'spanish', 'cantonese', 'hindi', 'tamil',
  'punjabi', 'arabic', 'other',
];
const REMOVED_LANDING_LANGUAGES = new Set([
  'mandarin', 'urdu', 'portuguese', 'tagalog', 'italian', 'german', 'japanese', 'vietnamese',
]);

const SAMPLE_VISITOR = {
  client: 'I am buying my first home and I do not know where to start.',
  agent: 'I keep missing follow-ups with new leads. How would Nesti help my team?',
  broker: 'Can Nesti help me speed up pre-approvals and keep renewals from slipping?',
  lawyer: 'How does Nesti fit a conveyancing practice with lender instructions and closings?',
};

/**
 * Each persona carries:
 * - directive: how it speaks (injected into the system prompt)
 * - opening: what the second greeting sentence should do
 * - style: reply shape budget used by shortenLandingReply
 * - roleLens: vocabulary focus per visitor role
 * - fallbackQuestion: the question used when the model fails
 * - differenceIntro: the first sentence of the "how is Nesti different" answer
 * - sample: canned preview reply per role (used when OpenAI is unavailable)
 */
export const PERSONALITY_PROFILES = {
  friendly: {
    id: 'friendly',
    name: 'Friendly and approachable',
    tagline: 'Listens first, then offers one easy choice.',
    manner: 'A calm person in the room. Names what feels heavy, then asks which part to take first.',
    description: 'For every role: acknowledge what they just said, in their words, before you mention Nesti.',
    bestFor: PERSONA_ROLES,
    directive: 'Persona: Friendly and approachable. You are talking with a person, not presenting a product. Buyers, sellers, agents, brokers, and lawyers all get the same care and a different subject. Use contractions. React to what they actually said. Never open with Certainly, Absolutely, or I would be happy to.',
    cadence: 'Two short spoken sentences. No feature list. The question should feel like a choice between two human next steps, not a menu.',
    opening: 'notice what their situation feels like and say, in plain words, that you can take it one piece at a time',
    style: { sentences: 2, bullets: 2, question: 'gentle' },
    roleLens: {
      client: 'Talk about the home search as something they do not have to figure out alone: budget, then the agent, broker, and lawyer who stay with them.',
      investor: 'Talk about the next property as a decision they do not have to make alone: the numbers, then the agent, broker, and lawyer who stay with that deal.',
      agent: 'Talk about the worry of a lead going quiet. A reply that goes out, and a page that feels like theirs.',
      broker: 'Talk about the pile of documents and the renewal that sneaks up. Make it feel manageable, not like a process diagram.',
      lawyer: 'Talk about the file, the lender, and the people waiting on a closing date. Keep it calm and specific.',
    },
    fallbackQuestion: {
      client: 'Want to start with what you can afford, or with who should be in your corner?',
      investor: 'Want to start with the numbers on the next property, or with who should be on that deal?',
      agent: 'Is the hard part the follow up, or getting your own page up?',
      broker: 'Is the tiring part the documents, or remembering who is coming up for renewal?',
      lawyer: 'Is the heavy part the closing itself, or keeping everyone updated while you get there?',
    },
    differenceIntro: 'The short version is that you stop juggling five tools for one transaction.',
    sample: {
      visitor: SAMPLE_VISITOR,
      reply: {
        client: 'A first home can feel like everyone else already knows the steps. You do not have to sort the budget and the people at the same time. Which one do you want to put down first?',
        agent: 'That quiet lead is the one that stings. Nesti can send the follow up while you are in a showing, from a page that is actually yours. Want the follow up sorted first, or the page?',
        broker: 'Pre-approvals drag when the documents are scattered, and renewals slip when nobody calls in time. We can take one of those off your desk. Which one is louder this week?',
        lawyer: 'A closing gets noisy when the lender, the client, and the realtor are all asking where the file stands. Nesti keeps the agreement and the closing date in one place. Want to start with the file, or with the updates people keep requesting?',
      },
    },
  },
  executive: {
    id: 'executive',
    name: 'Professional and polished',
    tagline: 'States the result, then asks for the decision.',
    manner: 'A sharp colleague. Short sentences, no slogans, one decision and then they stop.',
    description: 'For every role: name the outcome in one line, then ask which decision they want to make.',
    bestFor: PERSONA_ROLES,
    directive: 'Persona: Professional and polished. Speak like a sharp colleague to buyers, sellers, agents, brokers, and lawyers. Short sentences. No exclamation marks. No jargon such as leverage, throughput, velocity, actionable, or operational. Change the decision for the role. Do not change into a brochure.',
    cadence: 'One result, then one decision question. Do not list services. Do not soften the point with filler.',
    opening: 'name the result you can take off their plate, in one plain sentence, with no slogan',
    style: { sentences: 2, bullets: 3, question: 'direct' },
    roleLens: {
      client: 'The result is a purchase with a budget, a team, and a closing date that someone is watching.',
      investor: 'The result is an investment with the numbers, the team, and the closing date in one place.',
      agent: 'The result is a lead that gets a reply, and a team that can see which conversations are still open.',
      broker: 'The result is a faster pre-approval and a renewal that is called before it leaves.',
      lawyer: 'The result is a file that moves from intake to closing without a scavenger hunt for the lender instructions.',
    },
    fallbackQuestion: {
      client: 'Which decision comes first: the budget, or who represents you?',
      investor: 'Which decision comes first: the numbers, or who is on the deal?',
      agent: 'Which break is costing deals: the first reply, or the follow up after it?',
      broker: 'Which number do you want back: pre-approval time, or renewals kept?',
      lawyer: 'Which delay do you want gone: intake, or the closing itself?',
    },
    differenceIntro: 'Nesti is one system for the work you already do, not another place to store notes.',
    sample: {
      visitor: SAMPLE_VISITOR,
      reply: {
        client: 'A first purchase goes better when the budget and the team are decided before you tour. Nesti holds both. Budget, or the team?',
        agent: 'A missed follow up is a lost conversation, not a software problem. Nesti replies and keeps the thread where the team can see it. First reply, or the follow up after?',
        broker: 'Slow pre-approvals and missed renewals are the same leak: nobody owns the date. Nesti does. Which one do you want back first?',
        lawyer: 'Closings slip when the agreement and the lender instructions live in different inboxes. Nesti puts them on one file. Intake, or the closing date?',
      },
    },
  },
  consultative: {
    id: 'consultative',
    name: 'Thoughtful and consultative',
    tagline: 'Offers two causes, then waits.',
    manner: 'Curious, not scripted. They guess the cause, you correct them, then you talk about one fix.',
    description: 'For every role: do not explain the product until they tell you which problem is actually theirs.',
    bestFor: PERSONA_ROLES,
    directive: 'Persona: Thoughtful and consultative. Be curious with buyers, sellers, agents, brokers, and lawyers. Offer two likely causes in everyday words and wait. Do not pitch. Do not say root cause, workflow, or diagnostic. Map their answer to one Nesti capability only after they choose.',
    cadence: 'One observation, then a question that makes them pick. If they have not picked yet, do not explain a feature.',
    opening: 'mention the two reasons people in their role usually write in, and ask which one sounds like them',
    style: { sentences: 2, bullets: 2, question: 'diagnostic' },
    roleLens: {
      client: 'The two causes are not knowing the budget, or not knowing who should help. Wait for which one they pick.',
      investor: 'The two causes are unclear numbers, or not knowing who should be on the deal. Wait for which one they pick.',
      agent: 'The two causes are no reply before the lead goes cold, or no follow up after the first conversation.',
      broker: 'The two causes are slow document collection, or no call before a renewal date.',
      lawyer: 'The two causes are lender instructions arriving late, or client documents that never show up.',
    },
    fallbackQuestion: {
      client: 'Which is it for you: the budget, or who you should work with?',
      investor: 'Which is it for this property: the numbers, or who should be on the deal?',
      agent: 'Where does the lead go quiet: before you reply, or after the first conversation?',
      broker: 'Where does time go: collecting documents, or calling clients before renewal?',
      lawyer: 'Where does the file stall: late lender instructions, or documents the client still owes you?',
    },
    differenceIntro: 'Nesti is useful at the exact moment this work usually stalls.',
    sample: {
      visitor: SAMPLE_VISITOR,
      reply: {
        client: 'First-time buyers usually stall in one of two places: they do not know the budget, or they do not know who should be on the team. Which one is yours?',
        agent: 'Follow ups die in two places. Either nobody replies while the lead is still warm, or the thread dies after hello. Which one is happening?',
        broker: 'Pre-approvals slow down in the documents. Renewals slip because nobody calls in time. Which of those is the one you feel?',
        lawyer: 'Closings slip for two boring reasons: the lender instructions arrive late, or the client documents never land. Which one shows up more?',
      },
    },
  },
  sales: {
    id: 'sales',
    name: 'Confident and persuasive',
    tagline: 'One win, then a choice of what to do first.',
    manner: 'Forward, not a pitch deck. They name one win for that role and ask which to do now.',
    description: 'For every role: one concrete win, then they pick the first move. No invented numbers.',
    bestFor: PERSONA_ROLES,
    directive: 'Persona: Confident and persuasive. Be direct with buyers, sellers, agents, brokers, and lawyers. One win for their role, then a choice. Sound like a person who wants them moving, not a campaign. Never say unlock, supercharge, game-changer, or revenue engine. Never invent a number.',
    cadence: 'Name one win in a sentence they could say out loud. Then ask which move they want first. Stop. Do not add a second benefit.',
    opening: 'offer one specific win for their role and invite them to pick what to do first',
    style: { sentences: 2, bullets: 2, question: 'cta' },
    roleLens: {
      client: 'The win is a team and a budget in place before they waste weeks touring the wrong homes.',
      investor: 'The win is the numbers and the team in place before they commit to the wrong property.',
      agent: 'The win is a new lead getting a reply before they call the next agent, from a page with your name on it.',
      broker: 'The win is a pre-approval that is not waiting on a missing document, and a renewal you call first.',
      lawyer: 'The win is another closing that does not need a second inbox, plus work sent by agents and brokers you already know.',
    },
    fallbackQuestion: {
      client: 'Team first, or the budget?',
      investor: 'The numbers first, or the team?',
      agent: 'The first reply, or the page clients land on?',
      broker: 'Faster pre-approvals, or the renewal call?',
      lawyer: 'The closing file, or referrals from agents and brokers?',
    },
    differenceIntro: 'Other tools store the deal. Nesti moves the next step.',
    sample: {
      visitor: SAMPLE_VISITOR,
      reply: {
        client: 'You can have a budget and a team before you book a single showing. That is the part that saves the wasted weeks. Budget, or the team?',
        agent: 'The agent who replies first usually gets the conversation. Nesti sends that reply from a page with your name on it. Want the reply, or the page, first?',
        broker: 'A pre-approval moves when the documents are in one place. A renewal stays yours when you call before someone else does. Which do you want this week?',
        lawyer: 'You can close the file you have, or you can also take work that agents and brokers send you. Which matters more right now?',
      },
    },
  },
  luxury: {
    id: 'luxury',
    name: 'Luxury and sophisticated',
    tagline: 'Refined, selective, and unhurried.',
    manner: 'A discreet advisor. Elegant wording, no hype, one considered next step.',
    description: 'For every role: sound refined and selective, and never invent exclusivity.',
    bestFor: PERSONA_ROLES,
    directive: 'Persona: Luxury and sophisticated. Speak with elegance and restraint to buyers, sellers, agents, brokers, and lawyers. Short, polished sentences. No slang, no exclamation marks, and no invented exclusivity.',
    cadence: 'One refined observation, then one quiet question. Do not list services.',
    opening: 'acknowledge their situation in refined, unhurried language and offer to take one careful next step',
    style: { sentences: 2, bullets: 2, question: 'gentle' },
    roleLens: {
      client: 'Treat the purchase as a considered decision, with the right people around them.',
      investor: 'Treat the property as a considered investment, with the right people around the deal.',
      agent: 'Treat their practice as a reputation to protect, with a page and a reply that sound like them.',
      broker: 'Treat financing as a private, precise conversation, not a rush.',
      lawyer: 'Treat the closing as a careful file, with calm updates and no clutter.',
    },
    fallbackQuestion: {
      client: 'Shall we start with the budget, or with the people you want beside you?',
      investor: 'Shall we start with the numbers, or with the people you want on this deal?',
      agent: 'Shall we start with the first reply, or with the page clients see?',
      broker: 'Shall we start with the pre-approval, or with the renewal?',
      lawyer: 'Shall we start with the file, or with the updates people are waiting on?',
    },
    differenceIntro: 'Nesti keeps the work discreet and in one place.',
    sample: {
      visitor: SAMPLE_VISITOR,
      reply: {
        client: 'A first home deserves a calm plan, not a pile of tabs. We can begin with the budget or with the people who will stay with you. Which feels right?',
        agent: 'Your name should be on the reply and on the page. We can put the follow-up in place first, or the page. Which would you rather settle?',
        broker: 'Pre-approvals and renewals both suffer when the details are scattered. We can tidy one of them first. Which is more pressing?',
        lawyer: 'A closing is quieter when the agreement and the lender instructions live together. Shall we start with the file, or with the updates?',
      },
    },
  },
  caring: {
    id: 'caring',
    name: 'Caring and supportive',
    tagline: 'Patient, reassuring, and clear.',
    manner: 'A steady guide. Names the worry, then offers one small step.',
    description: 'For every role: slow down, reassure, and keep the next step small.',
    bestFor: PERSONA_ROLES,
    directive: 'Persona: Caring and supportive. Be patient and empathetic with buyers, sellers, agents, brokers, and lawyers. Reassure without pretending. One small next step. Never rush them and never invent a promise.',
    cadence: 'Acknowledge how this feels, then ask one gentle question. Do not pile on features.',
    opening: 'acknowledge that this can feel like a lot, and offer to take one small piece first',
    style: { sentences: 2, bullets: 2, question: 'gentle' },
    roleLens: {
      client: 'The worry is not knowing the steps. Stay with the budget or the team, not both at once.',
      investor: 'The worry is committing to the wrong property. Stay with the numbers or the team, not both at once.',
      agent: 'The worry is a lead going quiet. Offer the reply or the page, not a full tour.',
      broker: 'The worry is a date slipping. Offer the documents or the renewal call.',
      lawyer: 'The worry is a file with too many people waiting. Offer the file or the updates.',
    },
    fallbackQuestion: {
      client: 'Would you rather start with what you can afford, or with who should help you?',
      investor: 'Would you rather start with the numbers, or with who should help on this property?',
      agent: 'Would it help more to fix the first reply, or the follow-up after it?',
      broker: 'Would it help more to gather the documents, or to catch the renewal?',
      lawyer: 'Would it help more to see the file, or to quiet the update requests?',
    },
    differenceIntro: 'Nesti stays with the next step so you do not have to hold it all at once.',
    sample: {
      visitor: SAMPLE_VISITOR,
      reply: {
        client: 'A first home can feel like too many decisions at once. We can look at the budget, or at who should be with you. Which would feel lighter first?',
        agent: 'Missing a follow-up is frustrating, and it is fixable. We can set the reply, or the page clients land on. Which would help this week?',
        broker: 'It is tiring when a pre-approval waits on a missing document, or a renewal slips by. Which one should we ease first?',
        lawyer: 'Closings get heavy when everyone is asking where the file stands. We can start with the file, or with those updates. Which would help?',
      },
    },
  },
};

export const FORMALITY_LEVELS = {
  formal: {
    id: 'formal',
    short: 'Formal',
    name: 'Formal & Polished',
    description: 'Full words and no exclamation marks. "I am" stays "I am".',
    directive: 'Register: formal. Use refined, formal business English with full sentences. Avoid contractions, idioms, and casual phrasing. Do not use exclamation marks.',
  },
  professional: {
    id: 'professional',
    short: 'Professional',
    name: 'Business Professional',
    description: 'The written reply, kept as it is. This is the default.',
    directive: 'Register: professional. Use crisp, direct business language. Contractions are fine. Stay respectful and clear.',
  },
  casual: {
    id: 'casual',
    short: 'Casual',
    name: 'Conversational',
    description: 'Spoken contractions. "I am" becomes "I\'m".',
    directive: 'Register: casual. Use relaxed, conversational phrasing, contractions, and plain words while keeping full domain authority.',
  },
};

export function personalityFor(key) {
  return PERSONALITY_PROFILES[String(key || '').trim()] || PERSONALITY_PROFILES.friendly;
}

export function formalityFor(key) {
  return FORMALITY_LEVELS[String(key || '').trim()] || FORMALITY_LEVELS.professional;
}

export function personaRoleKey(audience) {
  const raw = String(audience || '').trim().toLowerCase();
  if (raw.includes('investor')) return 'investor';
  if (raw.includes('lawyer')) return 'lawyer';
  if (raw.includes('mortgage') || raw.includes('broker')) return 'broker';
  if (raw.includes('agent') || raw.includes('realtor')) return 'agent';
  return 'client';
}

export function landingBotIdentity(settings = {}) {
  const botName = text(settings?.bot_name) || DEFAULT_BOT_NAME;
  const displayName = text(settings?.display_name) || DEFAULT_DISPLAY_NAME;
  const personaTitle = text(settings?.bot_persona_title) || DEFAULT_PERSONA_TITLE;
  return { botName, displayName, personaTitle };
}

export function landingJoinUrl() {
  const base = String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/sign-up`;
}

export function landingWelcomeCopy(settings = {}, name = '') {
  const { botName } = landingBotIdentity(settings);
  const formality = formalityFor(settings?.formality).id;
  const who = text(name) || 'there';
  const joinUrl = landingJoinUrl();
  const subject = applyRegister(`Thanks for talking with ${botName}`, formality);
  const message = applyRegister(
    `Hi ${who}, I am ${botName}. Thank you for the conversation. A specialist can walk you through the plan that fits.\n\nJoin Nesti: ${joinUrl}`,
    formality,
  );
  return { subject, message, joinUrl, botName };
}

const GUIDE_SEEDS = {
  client: 'A client buying or selling is matched with a real estate agent, a mortgage broker, and a real estate lawyer. Nesti then gives progress tracking, budget tools, and support through the purchase or sale.',
  investor: 'An investor is matched with a real estate agent, a mortgage broker, and a real estate lawyer for the next property. Nesti then gives progress tracking, budget tools, and support through that purchase or sale.',
  agent: 'Agents get a chatbot they create and customize, a storefront that is their own web page, a lead inbox, referrals so they can refer a lead, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent.',
  broker: 'Mortgage brokers get a chatbot they create and customize, a storefront that is their own web page, a lead inbox, referrals, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent, plus pre-approval, affordability, renewal, and first-home financing.',
  lawyer: 'Real estate lawyers get a chatbot they create and customize, a storefront that is their own web page, a lead inbox, referrals, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent, plus the agreement, title, lender instructions, and closing.',
};

function text(value) {
  return String(value || '').trim();
}

const CONTRACTIONS = [
  [/\bI'm\b/g, 'I am'],
  [/\bi'm\b/g, 'i am'],
  [/\bDon't\b/g, 'Do not'],
  [/\bdon't\b/g, 'do not'],
  [/\bCan't\b/g, 'Cannot'],
  [/\bcan't\b/g, 'cannot'],
  [/\bWon't\b/g, 'Will not'],
  [/\bwon't\b/g, 'will not'],
  [/\bIt's\b/g, 'It is'],
  [/\bit's\b/g, 'it is'],
  [/\bThat's\b/g, 'That is'],
  [/\bthat's\b/g, 'that is'],
  [/\bYou're\b/g, 'You are'],
  [/\byou're\b/g, 'you are'],
  [/\bWe're\b/g, 'We are'],
  [/\bwe're\b/g, 'we are'],
  [/\bThey're\b/g, 'They are'],
  [/\bthey're\b/g, 'they are'],
  [/\bLet's\b/g, 'Let us'],
  [/\blet's\b/g, 'let us'],
  [/\bI've\b/g, 'I have'],
  [/\bi've\b/g, 'i have'],
  [/\bI'd\b/g, 'I would'],
  [/\bi'd\b/g, 'i would'],
  [/\bYou'll\b/g, 'You will'],
  [/\byou'll\b/g, 'you will'],
  [/\bWe'll\b/g, 'We will'],
  [/\bwe'll\b/g, 'we will'],
  [/\bIsn't\b/g, 'Is not'],
  [/\bisn't\b/g, 'is not'],
  [/\bAren't\b/g, 'Are not'],
  [/\baren't\b/g, 'are not'],
  [/\bDoesn't\b/g, 'Does not'],
  [/\bdoesn't\b/g, 'does not'],
  [/\bDidn't\b/g, 'Did not'],
  [/\bdidn't\b/g, 'did not'],
];

const EXPANSIONS = [
  [/\bLet us\b/g, "Let's"],
  [/\blet us\b/g, "let's"],
  [/\bI am\b/g, "I'm"],
  [/\bI have\b/g, "I've"],
  [/\bI would\b/g, "I'd"],
  [/\bDo not\b/g, "Don't"],
  [/\bdo not\b/g, "don't"],
  [/\bCannot\b/g, "Can't"],
  [/\bcannot\b/g, "can't"],
  [/\bWill not\b/g, "Won't"],
  [/\bwill not\b/g, "won't"],
  [/\bIt is\b/g, "It's"],
  [/\bit is\b/g, "it's"],
  [/\bThat is\b/g, "That's"],
  [/\bthat is\b/g, "that's"],
  [/\bYou are\b/g, "You're"],
  [/\byou are\b/g, "you're"],
  [/\bWe are\b/g, "We're"],
  [/\bwe are\b/g, "we're"],
  [/\bThey are\b/g, "They're"],
  [/\bthey are\b/g, "they're"],
];

/** Formal expands contractions and drops exclamation marks. Casual uses contractions. Professional stays as written. */
export function applyRegister(value, formality = 'professional') {
  const raw = String(value || '');
  if (formality === 'casual') {
    let next = raw;
    for (const [pattern, replacement] of EXPANSIONS) next = next.replace(pattern, replacement);
    return next;
  }
  if (formality !== 'formal') return raw;
  let next = raw;
  for (const [pattern, replacement] of CONTRACTIONS) next = next.replace(pattern, replacement);
  next = next.replace(/!+/g, '.').replace(/\.{2,}/g, '.');
  return next.replace(/(^|[.]\s+)([a-z])/g, (match, lead, letter) => lead + letter.toUpperCase());
}

export function sanitizeLandingGuideText(value, { maxLength = 2000 } = {}) {
  let next = text(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[(.*?)\]/g, '$1')
    .replace(/\*\*|\*|_+|#{1,6}|`/g, ' ')
    .replace(/^(?:[-*•]\s*)+/gm, '')
    .replace(/\b(?:ignore|override|bypass|jailbreak)\b/gi, ' ')
    .replace(/\b(?:system|developer)\s+prompt\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!next) return '';
  if (next.length > maxLength) next = next.slice(0, maxLength).trim();
  return next.replace(/\s+([,.!?])/g, '$1');
}

function clip(value, max = 2000) {
  return text(value).slice(0, max);
}

const CLIENT_PLAN_CARDS = {
  basic: {
    description: 'For buyers and sellers who want progress tracking, a simple budget, and a first set of matches.',
    popular: false,
  },
  standard: {
    description: 'For an active purchase or sale that needs fuller planning, more matches, and chat support.',
    popular: true,
  },
  pro: {
    description: 'For buyers and sellers who want unlimited matching, priority, and a dedicated guide.',
    popular: false,
  },
};

const PROFESSIONAL_PLAN_CARDS = {
  basic: {
    description: 'Core workspace access for professionals who need lead capture, basic CRM, and manual follow-up.',
    features: [
      'Basic chatbot and lead capture',
      'Lead scoring, classification, and CRM list',
      'Up to 50 captured leads',
      'Manual nurture emails (up to 50)',
      '1:1 professional conversations',
      'Notes, referrals, and client management',
    ],
    popular: false,
  },
  standard: {
    description: 'Advanced workflows for active professionals using automation, insights, calendar, and referrals.',
    features: [
      'Everything in Basic with up to 150 leads per month',
      'Bulk follow-up workspace (up to 500 emails)',
      'Calendly calendar integration',
      'Advanced lead insights and conversation transcript',
      'Analytics, web page, and AI assistant tools',
      'Group pro chat and referral invite links',
    ],
    popular: true,
  },
  enterprise: {
    description: 'Highest capacity for teams and high-volume professionals using the full existing Nesti workspace.',
    features: [
      'Everything in Standard',
      'Higher chatbot conversation capacity',
      'Higher lead capture capacity',
      'Higher AI assistant and report capacity',
      'Higher nurture and follow-up capacity',
      'Higher referral and analytics capacity',
    ],
    popular: false,
  },
};

function planCard(plan, extra) {
  return {
    plan_key: plan.plan_key,
    name: plan.name,
    price: plan.display_amount,
    period: '/month',
    description: extra.description,
    features: extra.features || plan.features || [],
    popular: Boolean(extra.popular),
  };
}

export function landingChatPlanCards() {
  return {
    client: Object.values(CLIENT_PLANS).map((plan) => planCard(plan, CLIENT_PLAN_CARDS[plan.tier] || {})),
    professional: Object.values(BILLING_PLANS)
      .filter((plan) => plan.display_amount)
      .map((plan) => planCard(plan, PROFESSIONAL_PLAN_CARDS[plan.plan_key] || {})),
  };
}

export function planFacts(audience = 'client') {
  const professional = audience === 'agent' || audience === 'lawyer' || audience === 'mortgage_broker' || audience === 'broker';
  const source = professional ? BILLING_PLANS : CLIENT_PLANS;
  const lines = Object.values(source)
    .filter((plan) => plan.display_amount)
    .map((plan) => `${plan.name} at ${String(plan.display_amount).replace('$', '')} dollars a month`)
    .join('. ');
  const label = professional ? 'Professional plans only' : 'Client plans only';
  return `${label}: ${lines}. Say money in words. Never mention a price from the other catalog. Never invent a price or a discount.`;
}

export function landingSettingsView(doc, embed = null) {
  return {
    enabled: doc?.enabled !== false,
    welcome_message: text(doc?.welcome_message),
    bot_name: text(doc?.bot_name) || DEFAULT_BOT_NAME,
    display_name: text(doc?.display_name) || DEFAULT_DISPLAY_NAME,
    bot_persona_title: text(doc?.bot_persona_title) || DEFAULT_PERSONA_TITLE,
    personality: PERSONALITY_KEYS.includes(doc?.personality) ? doc.personality : 'friendly',
    formality: FORMALITY_KEYS.includes(doc?.formality) ? doc.formality : 'professional',
    personalities: PERSONALITY_PROFILES,
    formalities: FORMALITY_LEVELS,
    defaults: {
      bot_name: DEFAULT_BOT_NAME,
      display_name: DEFAULT_DISPLAY_NAME,
      bot_persona_title: DEFAULT_PERSONA_TITLE,
    },
    consent_line: text(doc?.consent_line),
    signup_cta_copy: text(doc?.signup_cta_copy),
    client_guide: sanitizeLandingGuideText(doc?.client_guide),
    agent_guide: sanitizeLandingGuideText(doc?.agent_guide),
    broker_guide: sanitizeLandingGuideText(doc?.broker_guide),
    lawyer_guide: sanitizeLandingGuideText(doc?.lawyer_guide),
    role_customizations: sanitizeLandingRoleCustomizations(doc?.role_customizations),
    previous_settings: doc?.previous_settings || null,
    seeds: GUIDE_SEEDS,
    auto_welcome_followup: Boolean(doc?.auto_welcome_followup),
    dual_write_inquiry: Boolean(doc?.dual_write_inquiry),
    embed_ready: Boolean(embed?.token),
    embed_id: embed?._id ? String(embed._id) : '',
  };
}

export function normalizeLandingContactFields(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_CONTACT_FIELDS];
  return [...new Set(raw.map((item) => clip(String(item || '').trim(), 40)).filter((item) => LANDING_CONTACT_FIELDS.includes(item)))].slice(0, 4);
}

export function normalizeLandingNextActions(raw) {
  const source = Array.isArray(raw) ? raw.map((item) => clip(String(item || '').trim(), 40)).filter(Boolean) : [];
  const kept = [...new Set(source.filter((item) => LANDING_NEXT_ACTIONS.includes(item)))];
  if (!source.includes('notify_admins') && !source.includes('save_lead')) {
    kept.push('notify_admins', 'save_lead');
  }
  return [...new Set(kept)].slice(0, 5);
}

export function sanitizeLandingRoleCustomizations(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const output = {};
  for (const role of LANDING_ROLE_CUSTOMIZATIONS) {
    const value = source[role] && typeof source[role] === 'object' && !Array.isArray(source[role])
      ? source[role]
      : {};
    const list = (key, maxItems, maxLength = 100) => (
      Array.isArray(value[key])
        ? [...new Set(value[key].map((item) => clip(item, maxLength)).filter(Boolean))].slice(0, maxItems)
        : []
    );
    const customTones = Array.isArray(value.custom_tones)
      ? [...new Map(value.custom_tones.slice(0, 8)
      .map((tone) => ({
        id: clip(tone?.id, 39),
        name: clip(tone?.name, 40),
        guidance: sanitizeLandingGuideText(tone?.guidance, { maxLength: 200 }),
      }))
      .filter((tone) => /^custom-[a-f0-9]{32}$/.test(tone.id) && tone.name.length >= 2 && tone.guidance.length >= 8)
      .map((tone) => [tone.id, tone])).values()]
      : [];
    const allowedTones = new Set([
      ...ROLE_CUSTOMIZATION_PERSONALITIES,
      ...customTones.map((tone) => tone.id),
    ]);
    const savedFaqs = (Array.isArray(value.faqs) ? value.faqs : [])
      .slice(0, 20)
      .map((faq) => ({
        id: clip(faq?.id, 80),
        question: clip(faq?.question, 240),
        answer: clip(faq?.answer, 1200),
        is_default: faq?.is_default === true,
      }))
      .filter((faq) => faq.question && faq.answer);
    const defaultFaqs = LANDING_CHAT_FAQS[role].map((faq, index) => {
      const id = `${role}-faq-${String(index + 1).padStart(2, '0')}`;
      const saved = savedFaqs.find((item) => (
        item.id === id
        || item.question.toLowerCase() === faq.question.toLowerCase()
      ));
      const question = saved?.question || faq.question;
      const answer = saved?.answer || faq.answer;
      return {
        id,
        question,
        answer,
        is_default: true,
        edited: Boolean(saved && (question !== faq.question || answer !== faq.answer)),
      };
    });
    const defaultFaqIds = new Set(defaultFaqs.map((faq) => faq.id));
    const defaultFaqQuestions = new Set(defaultFaqs.map((faq) => faq.question.toLowerCase()));
    const customFaqs = savedFaqs
      .filter((faq) => !defaultFaqIds.has(faq.id) && !defaultFaqQuestions.has(faq.question.toLowerCase()))
      .slice(0, 8)
      .map((faq, index) => ({
        ...faq,
        id: faq.id || `${role}-custom-faq-${index + 1}`,
        is_default: false,
      }));
    output[role] = {
      enabled: Boolean(value.enabled),
      personalities: list('personalities', 2, 39).filter((item) => allowedTones.has(item)),
      custom_tones: customTones,
      languages: list('languages', 20, 60).filter((item) => {
        const key = item.toLowerCase();
        if (REMOVED_LANDING_LANGUAGES.has(key)) return false;
        return ROLE_CUSTOMIZATION_LANGUAGES.includes(key) || /^[\p{L}\p{M} .'-]{2,60}$/u.test(item);
      }),
      auto_detect_language: value.auto_detect_language !== false,
      communication_style: ROLE_CUSTOMIZATION_COMMUNICATION.includes(value.communication_style)
        ? value.communication_style
        : 'conversational',
      use_emojis: Boolean(value.use_emojis),
      address_by_first_name: value.address_by_first_name !== false,
      focus_areas: list('focus_areas', 20, 120),
      differentiators: list('differentiators', 15, 120),
      difference_line: clip(value.difference_line, 240),
      custom_guidance: sanitizeLandingGuideText(value.custom_guidance, { maxLength: 2000 }),
      website_reference: '',
      services_pricing: sanitizeLandingGuideText(value.services_pricing, { maxLength: 2000 }),
      qualification_questions: list('qualification_questions', 5, 40).filter((item) => HOMEPAGE_QUALIFICATION_IDS.includes(item)),
      contact_fields: normalizeLandingContactFields(value.contact_fields),
      next_actions: normalizeLandingNextActions(value.next_actions),
      faqs: [...defaultFaqs, ...customFaqs],
    };
  }
  return output;
}

const SHARED_ROLE_FIELDS = [
  'personalities',
  'custom_tones',
  'languages',
  'auto_detect_language',
  'communication_style',
  'use_emojis',
  'address_by_first_name',
  'qualification_questions',
  'contact_fields',
  'next_actions',
];

export function shareLandingRoleTraining(roles = {}) {
  const source = roles.client || {};
  const output = {};
  for (const role of LANDING_ROLE_CUSTOMIZATIONS) {
    output[role] = { ...(roles[role] || {}), enabled: true, website_reference: '' };
    for (const key of SHARED_ROLE_FIELDS) output[role][key] = source[key];
  }
  return output;
}

export function guideForAudience(settings, audience) {
  const key = audience === 'mortgage_broker' || audience === 'broker' ? 'broker' : audience;
  if (key === 'investor') return GUIDE_SEEDS.investor;
  const field = key === 'client' || key === 'agent' || key === 'broker' || key === 'lawyer' ? `${key}_guide` : 'client_guide';
  const custom = sanitizeLandingGuideText(settings?.[field]);
  const seedKey = key === 'broker' ? 'broker' : key;
  return custom || GUIDE_SEEDS[seedKey] || GUIDE_SEEDS.client;
}

export async function loadLandingChatSettings() {
  return LandingChatSetting.findOne({ key: 'landing' }).lean();
}

export async function loadLandingChatSettingsRequired() {
  try {
    return await loadLandingChatSettings();
  } catch (error) {
    logger.error('Landing chatbot settings could not be loaded', { error: error?.message || String(error) });
    const unavailable = new Error('Chatbot settings are temporarily unavailable. Please try again.');
    unavailable.status = 503;
    throw unavailable;
  }
}

export async function bindLandingChatSessionAudience(sessionId, audience) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const initialAudience = audience || 'client';
  let session;
  try {
    session = await LandingChatSession.findOneAndUpdate(
      { session_id: sessionId },
      {
        $set: { expires_at: expiresAt },
        $setOnInsert: { audience_role: initialAudience },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
  } catch (error) {
    if (error?.code !== 11000) {
      logger.error('Landing chatbot session audience could not be stored', { error: error?.message || String(error) });
      const unavailable = new Error('Chat session security is temporarily unavailable. Please try again.');
      unavailable.status = 503;
      throw unavailable;
    }
    try {
      session = await LandingChatSession.findOne({ session_id: sessionId }).lean();
    } catch (lookupError) {
      logger.error('Landing chatbot session audience could not be read', { error: lookupError?.message || String(lookupError) });
      const unavailable = new Error('Chat session security is temporarily unavailable. Please try again.');
      unavailable.status = 503;
      throw unavailable;
    }
  }
  if (!session) {
    const unavailable = new Error('Chat session security is temporarily unavailable. Please try again.');
    unavailable.status = 503;
    throw unavailable;
  }
  return {
    audience: session.audience_role,
    matches: !audience || session.audience_role === audience,
  };
}

export async function findLandingEmbedRequired() {
  try {
    return await findLandingEmbed();
  } catch (error) {
    logger.error('Landing chatbot embed could not be loaded', { error: error?.message || String(error) });
    const unavailable = new Error('Chatbot configuration is temporarily unavailable. Please try again.');
    unavailable.status = 503;
    throw unavailable;
  }
}

export async function ensureLandingEmbedRequired() {
  try {
    return await ensureLandingEmbed();
  } catch (error) {
    logger.error('Landing chatbot embed could not be initialized', { error: error?.message || String(error) });
    const unavailable = new Error('Chatbot configuration is temporarily unavailable. Please try again.');
    unavailable.status = 503;
    throw unavailable;
  }
}

export function settingsPayload(body = {}) {
  const role_customizations = shareLandingRoleTraining(sanitizeLandingRoleCustomizations(body.role_customizations));
  const selectedTone = (role_customizations.client?.personalities || []).find((id) => PERSONALITY_KEYS.includes(id));
  return {
    enabled: body.enabled !== false && body.enabled !== 'false',
    welcome_message: clip(body.welcome_message),
    bot_name: clip(body.bot_name, 40) || DEFAULT_BOT_NAME,
    display_name: clip(body.display_name, 80) || DEFAULT_DISPLAY_NAME,
    bot_persona_title: clip(body.bot_persona_title, 80) || DEFAULT_PERSONA_TITLE,
    personality: selectedTone || (PERSONALITY_KEYS.includes(body.personality) ? body.personality : 'friendly'),
    formality: FORMALITY_KEYS.includes(body.formality) ? body.formality : 'professional',
    consent_line: clip(body.consent_line, 400),
    signup_cta_copy: clip(body.signup_cta_copy, 400),
    client_guide: sanitizeLandingGuideText(body.client_guide),
    agent_guide: sanitizeLandingGuideText(body.agent_guide),
    broker_guide: sanitizeLandingGuideText(body.broker_guide),
    lawyer_guide: sanitizeLandingGuideText(body.lawyer_guide),
    role_customizations,
    auto_welcome_followup: Boolean(body.auto_welcome_followup),
    dual_write_inquiry: Boolean(body.dual_write_inquiry),
  };
}

export async function saveLandingChatSettings(body) {
  const current = await LandingChatSetting.findOne({ key: 'landing' }).lean();
  const snapshot = current ? { ...current } : null;
  if (snapshot) {
    delete snapshot._id;
    delete snapshot.__v;
    delete snapshot.key;
    delete snapshot.previous_settings;
    delete snapshot.createdAt;
    delete snapshot.updatedAt;
  }
  return LandingChatSetting.findOneAndUpdate(
    { key: 'landing' },
    { $set: { ...settingsPayload(body), previous_settings: snapshot }, $setOnInsert: { key: 'landing' } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
}

export function isLandingEmbed(embed) {
  return Boolean(embed?.widget_settings && embed.widget_settings.landing_mode);
}

function defaultDomains() {
  const raw = text(process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL);
  const list = raw.split(',').map((item) => item.trim()).filter(Boolean);
  for (const host of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    if (!list.includes(host)) list.push(host);
  }
  return list;
}

export async function findLandingEmbed() {
  return ChatbotEmbedUrl.findOne({ 'widget_settings.landing_mode': true }).sort({ createdAt: -1 }).lean();
}

async function resolveLandingOwnerId() {
  const admin = await User.findOne({ role: 'admin', is_active: { $ne: false } }).select('_id').sort({ createdAt: 1 }).lean();
  if (admin?._id) return admin._id;
  const professional = await User.findOne({
    role: { $in: ['agent', 'lawyer', 'mortgage_broker'] },
    is_active: { $ne: false },
  }).select('_id').sort({ createdAt: 1 }).lean();
  return professional?._id || null;
}

export async function ensureLandingEmbed() {
  const existing = await ChatbotEmbedUrl.findOne({ 'widget_settings.landing_mode': true }).sort({ createdAt: -1 });
  if (existing) {
    return { ok: true, token: existing.token, embed: existing, reused: true };
  }
  const userId = await resolveLandingOwnerId();
  if (!userId) {
    return { ok: false, message: 'No admin account is available to hold homepage leads.' };
  }
  const embed = await ChatbotEmbedUrl.create({
    user_id: userId,
    token: crypto.randomBytes(24).toString('hex'),
    widget_role: 'agent',
    allowed_domains: defaultDomains(),
    widget_settings: { landing_mode: true, display_name: 'Nesti' },
  });
  return { ok: true, token: embed.token, embed, reused: false };
}

const hits = new Map();

export function allowLandingChatRate(ip, visitorId) {
  const key = `${text(ip) || 'ip'}|${text(visitorId) || 'visitor'}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= 20) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [stored, stamps] of hits) {
      if (!stamps.some((stamp) => now - stamp < 60_000)) hits.delete(stored);
    }
  }
  return true;
}
