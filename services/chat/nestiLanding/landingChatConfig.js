import crypto from 'crypto';
import User from '../../../models/User.js';
import ChatbotEmbedUrl from '../../../models/ChatbotEmbedUrl.js';
import LandingChatSetting from '../../../models/LandingChatSetting.js';
import { CLIENT_PLANS } from '../../client/plans.js';
import { BILLING_PLANS } from '../../billing/plans.js';

export const LANDING_AUDIENCES = ['client', 'agent', 'mortgage_broker', 'lawyer'];

const GUIDE_SEEDS = {
  client: 'A client buying or selling is matched with a real estate agent, a mortgage broker, and a real estate lawyer. Nesti then gives progress tracking, budget tools, and support through the purchase or sale.',
  agent: 'Agents get a chatbot they create and customize, a storefront that is their own web page, a lead inbox, referrals so they can refer a lead, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent.',
  broker: 'Mortgage brokers get a chatbot they create and customize, a storefront that is their own web page, a lead inbox, referrals, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent, plus pre-approval, affordability, renewal, and first-home financing.',
  lawyer: 'Real estate lawyers get a chatbot they create and customize, a storefront that is their own web page, a lead inbox, referrals, AI-generated emails, nurture follow-ups, pipeline management, performance tracking, autopilot, and a voice agent, plus the agreement, title, lender instructions, and closing.',
};

function text(value) {
  return String(value || '').trim();
}

export function sanitizeLandingGuideText(value, { maxLength = 600 } = {}) {
  let next = text(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[(.*?)\]/g, '$1')
    .replace(/\*\*|\*|_+|#{1,6}|`/g, ' ')
    .replace(/^(?:[-*•]\s*)+/gm, '')
    .replace(/\b(?:ignore|override|system|prompt|instructions?|assistant|developer|always|never|do not|don't|stop|bypass)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!next) return '';
  next = next.replace(/\s+(?:and|or)\s+/gi, ' ');
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
    display_name: text(doc?.display_name) || 'Nesti',
    consent_line: text(doc?.consent_line),
    signup_cta_copy: text(doc?.signup_cta_copy),
    client_guide: sanitizeLandingGuideText(doc?.client_guide),
    agent_guide: sanitizeLandingGuideText(doc?.agent_guide),
    broker_guide: sanitizeLandingGuideText(doc?.broker_guide),
    lawyer_guide: sanitizeLandingGuideText(doc?.lawyer_guide),
    seeds: GUIDE_SEEDS,
    auto_welcome_followup: Boolean(doc?.auto_welcome_followup),
    dual_write_inquiry: Boolean(doc?.dual_write_inquiry),
    embed_ready: Boolean(embed?.token),
    embed_id: embed?._id ? String(embed._id) : '',
  };
}

export function guideForAudience(settings, audience) {
  const key = audience === 'mortgage_broker' || audience === 'broker' ? 'broker' : audience;
  const field = key === 'client' || key === 'agent' || key === 'broker' || key === 'lawyer' ? `${key}_guide` : 'client_guide';
  const custom = sanitizeLandingGuideText(settings?.[field]);
  const seedKey = key === 'broker' ? 'broker' : key;
  return custom || GUIDE_SEEDS[seedKey] || GUIDE_SEEDS.client;
}

export async function loadLandingChatSettings() {
  return LandingChatSetting.findOne({ key: 'landing' }).lean();
}

export function settingsPayload(body = {}) {
  return {
    enabled: body.enabled !== false && body.enabled !== 'false',
    welcome_message: clip(body.welcome_message),
    display_name: clip(body.display_name, 80) || 'Nesti',
    consent_line: clip(body.consent_line, 400),
    signup_cta_copy: clip(body.signup_cta_copy, 400),
    client_guide: sanitizeLandingGuideText(body.client_guide),
    agent_guide: sanitizeLandingGuideText(body.agent_guide),
    broker_guide: sanitizeLandingGuideText(body.broker_guide),
    lawyer_guide: sanitizeLandingGuideText(body.lawyer_guide),
    auto_welcome_followup: Boolean(body.auto_welcome_followup),
    dual_write_inquiry: Boolean(body.dual_write_inquiry),
  };
}

export async function saveLandingChatSettings(body) {
  return LandingChatSetting.findOneAndUpdate(
    { key: 'landing' },
    { $set: settingsPayload(body), $setOnInsert: { key: 'landing' } },
    { upsert: true, new: true },
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
