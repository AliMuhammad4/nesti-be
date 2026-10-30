import User from '../../models/User.js';
import ClientProfile from '../../models/ClientProfile.js';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import VoiceAgentSalesSetting from '../../models/VoiceAgentSalesSetting.js';
import { CLIENT_PLANS } from '../client/plans.js';
import { BILLING_PLANS } from '../billing/plans.js';
import { createClientCheckoutSession } from '../client/clientSubscriptionService.js';
import { createCheckoutSessionForUser } from '../billing/subscriptionCheckoutService.js';

const SPOKEN_AMOUNTS = {
  '$9.99': 'nine dollars and ninety-nine cents',
  '$24.99': 'twenty-four dollars and ninety-nine cents',
  '$49.99': 'forty-nine dollars and ninety-nine cents',
  '$150': 'one hundred fifty dollars',
  '$300': 'three hundred dollars',
  '$600': 'six hundred dollars',
};

export const BUILTIN_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin'];

const LEADS = 'The public page and chatbot collect the inquiry into the lead inbox.';
const EMAIL = 'Draft, refine, and preview a follow-up in their situation, then send it.';
const NURTURE = 'A sequence of follow-up emails, including bulk drafts.';

export const GUIDE_FIELDS = {
  client: [
    { id: 'goal', label: 'Goal', hint: 'Buy or sell. Do not open with a plan.', text: 'They can buy or sell a home.' },
    { id: 'agent', label: 'Real estate agent', hint: 'Search through the offer.', text: 'Match a real estate agent for search, listings, showings, and offers.' },
    { id: 'broker', label: 'Mortgage broker', hint: 'Financing only.', text: 'Match a mortgage broker for financing, pre-approval, and renewal.' },
    { id: 'lawyer', label: 'Real estate lawyer', hint: 'Agreement through closing.', text: 'Match a real estate lawyer for the agreement, title, and closing.' },
    { id: 'tools', label: 'Client tools', hint: 'Only when they ask how Nesti helps them.', text: 'Mention progress tracking, budget tools, recommendations, and support when they fit.' },
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

export function speakAmount(display) {
  const raw = text(display);
  if (SPOKEN_AMOUNTS[raw]) return SPOKEN_AMOUNTS[raw];
  return raw.replace(/\$/g, '');
}

export function allowedVoice(value, fallback = 'ash') {
  const voice = text(value).toLowerCase();
  if (BUILTIN_VOICES.includes(voice)) return voice;
  if (value === 'female') return 'coral';
  if (value === 'male') return 'ash';
  return fallback;
}

function planLines(plans) {
  return Object.values(plans)
    .map((plan) => `${plan.name} at ${speakAmount(plan.display_amount)} a month`)
    .join('. ');
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

export function livePlanFacts(role) {
  const client = briefKey(role) === 'client';
  const prices = planLines(client ? CLIENT_PLANS : BILLING_PLANS);
  return `Say money in words, never with a dollar sign. Name at most one plan. ${prices}. Do not invent prices or a discount.`;
}

export function liveSalesInstructions({ role, caller, settings }) {
  const name = text(caller?.name);
  const note = text(caller?.note);
  const who = name
    ? `The caller's name is ${name}. Greet them by that name once.`
    : 'No name is on file. Do not invent a name.';
  const filed = note
    ? `One note already on file: ${note}. Use it only when it fits what they just said.`
    : 'No earlier note is on file. Do not invent one.';
  return `You are Ravi on a live Nesti sales call. Your first spoken turn introduces you. After that, do not introduce yourself again.
Decision path, in order:
1. Hear their goal. Do not pitch yet. Do not call record_sales_outcome on the greeting or after your own plan mention.
2. Explain the one topic that matches what they just said. Do not read the other topics.
3. Name one plan and its monthly price in words, and ask them to start it.
4. Call record_sales_outcome only after they clearly agree, clearly decline, or clearly ask for a callback. Naming a plan is not an agreement.
If they say it is too expensive or ask for cheaper, acknowledge it and offer the next plan down once. Do not invent a discount.
If they want to think about it, want it sent later, or want a callback, call record_sales_outcome with callback, confirm the follow-up in one sentence, and stop pitching.
Every spoken turn is at most two short sentences. Answer the latest thing they said. Do not repeat the last question or a plan you already named. Never list more than one plan. Never say "great question", "absolutely", or "I'd be happy to". Never say the purchase is complete. Never read a web address.
English is the primary language. The greeting is English. After that, reply in French, Spanish, Arabic, or Urdu only when their latest words are in that language. If they switch, stay in the new language, including the subscription ask. If you are unsure, stay in English. Arabic and Urdu are different: answer Arabic in Arabic and Urdu in Urdu. Never say you cannot speak these languages.
Topics, one at a time: ${serviceLine(role, settings)}
${livePlanFacts(role)}
${who} ${filed}`;
}

export async function loadSalesSettings() {
  return VoiceAgentSalesSetting.findOne({ key: 'sales' }).lean();
}

export function speechSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 1;
  return Math.min(1.12, Math.max(0.9, Math.round(speed * 100) / 100));
}

export function responseEagerness(value) {
  const raw = text(value).toLowerCase();
  if (raw === 'low' || raw === 'high') return raw;
  return 'medium';
}

export function bargeIn(value) {
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return true;
}

export function silenceSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 8;
  return Math.min(16, Math.max(5, Math.round(seconds)));
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

export function salesSettingsView(doc) {
  return {
    voice: allowedVoice(doc?.voice, 'marin'),
    speech_speed: speechSpeed(doc?.speech_speed),
    vad_eagerness: responseEagerness(doc?.vad_eagerness),
    barge_in: bargeIn(doc?.barge_in),
    silence_seconds: silenceSeconds(doc?.silence_seconds),
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
    seeds: SERVICE_SEEDS,
    voices: BUILTIN_VOICES,
    sample_saved: Boolean(text(doc?.sample_key)),
    clone_ready: Boolean(text(doc?.clone_voice_id)),
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

function clientTier(planLabel) {
  const raw = text(planLabel).toLowerCase();
  if (raw.includes('pro')) return 'pro';
  if (raw.includes('basic')) return 'basic';
  return 'standard';
}

function professionalPlanKey(planLabel) {
  const raw = text(planLabel).toLowerCase();
  if (raw.includes('enterprise')) return 'enterprise';
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
