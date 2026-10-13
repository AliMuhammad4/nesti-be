import OpenAI from 'openai';
import crypto from 'crypto';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import User from '../../models/User.js';
import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import { fail, ok } from './adminCommon.js';
import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { formalityFor, guideForAudience, landingBotIdentity, landingChatPlanCards, loadLandingChatSettings, personalityFor } from '../chat/nestiLanding/landingChatConfig.js';
import { EMAIL_BRAND, EMAIL_FONT, renderBrandedEmailShell } from '../email/emailTheme.js';

export const salesEmailDeps = { sendEmail };

function text(value) {
  return String(value || '').trim();
}

function plainText(value) {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '[object Object]' ? '' : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join('. ');
  if (typeof value === 'object') {
    const ordered = ['name', 'plan', 'title', 'price', 'period', 'reason', 'why', 'description', 'summary', 'text']
      .map((key) => plainText(value[key]))
      .filter(Boolean);
    return ordered.length ? ordered.join(' ') : Object.values(value).map(plainText).filter(Boolean).join(' ');
  }
  return '';
}

function audienceKey(role) {
  const raw = text(role).toLowerCase();
  if (raw === 'agent' || raw === 'lawyer' || raw === 'mortgage_broker' || raw === 'broker') {
    return raw === 'broker' ? 'broker' : raw;
  }
  return 'client';
}

function planLines(audience) {
  const cards = landingChatPlanCards();
  const list = audience === 'client' ? cards.client : cards.professional;
  return list.map((plan) => `${plan.name} ${plan.price}${plan.period}: ${plan.description}`).join('\n');
}

const PROFESSIONAL_SERVICE_CARDS = [
  {
    title: /chatbot/i,
    phrase: /any page|anywhere|any website|own site|integrat/i,
    extra: 'You can place it on your own site or any page you choose.',
    line: 'Chatbot: You create and customize your own chatbot, then place it on your website or any page you choose so people can start a conversation from anywhere.',
  },
  {
    title: /storefront/i,
    phrase: /web page|own page|your own website/i,
    extra: 'It is your own web page, with your brand and your services in one place.',
    line: 'Storefront: Your storefront is your own web page. Clients see your brand, your services, and what you offer in one place.',
  },
  {
    title: /voice/i,
    phrase: /call|phone|speak/i,
    extra: 'It answers calls and speaks with people when you are away.',
    line: 'Voice agent: The voice agent answers calls and speaks with people when you are away, so a new inquiry is never left waiting.',
  },
  {
    title: /pipeline/i,
    phrase: /follow-up|next step|every lead/i,
    extra: 'It keeps every lead in view from the first message through each follow-up.',
    line: 'Pipeline: The pipeline keeps every lead in view, from the first message through each follow-up, so you always know the next step.',
  },
  {
    title: /email marketing/i,
    phrase: /campaign/i,
    extra: 'It writes and sends campaigns that stay personal.',
    line: 'Email marketing: Email marketing writes and sends campaigns that stay personal and reach the people you want to stay in touch with.',
  },
  {
    title: /^support(\s+module)?$/i,
    phrase: /module|notes|questions/i,
    extra: 'It holds notes, client questions, and the help you need while you work a lead.',
    line: 'Support: The support module holds notes, client questions, and the help you need while you work a lead.',
  },
];

const CLIENT_SERVICE_CARDS = [
  {
    title: /match|professional|team/i,
    phrase: /agent|broker|lawyer/i,
    extra: 'That match includes a real estate agent, a mortgage broker, and a real estate lawyer.',
    line: 'Matched professionals: Nesti matches you with a real estate agent, a mortgage broker, and a real estate lawyer for the purchase or sale.',
  },
  {
    title: /progress/i,
    phrase: /step/i,
    extra: 'You can see each step of the purchase or sale.',
    line: 'Progress tracking: You can see each step of the purchase or sale, so you always know what is done and what comes next.',
  },
  {
    title: /budget/i,
    phrase: /afford|budget/i,
    extra: 'The tools show what you can afford and keep the numbers clear.',
    line: 'Budget tools: Budget tools show what you can afford and keep the numbers clear while you decide.',
  },
  {
    title: /^support(\s+module)?$/i,
    phrase: /question|help/i,
    extra: 'Support stays with you so you have a place to ask questions.',
    line: 'Support: Support stays with you through the purchase or sale, so you have a place to ask questions and get help.',
  },
];

function serviceCardsFor(audience) {
  return audience === 'client' ? CLIENT_SERVICE_CARDS : PROFESSIONAL_SERVICE_CARDS;
}

function bulletTitle(line) {
  const raw = text(line).replace(/^[-•]\s+/, '');
  const splitAt = raw.indexOf(':');
  return (splitAt < 0 ? raw : raw.slice(0, splitAt)).trim();
}

function ensureServiceCards(body, audience) {
  const cleaned = cleanEmailBody(body);
  if (!cleaned) return '';
  const specs = serviceCardsFor(audience);
  const lines = cleaned.split('\n');
  const intro = [];
  const cards = [];
  const closing = [];
  let seenBullet = false;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^[-•]\s+/.test(trimmed) && !closing.length) {
      seenBullet = true;
      cards.push(trimmed);
      return;
    }
    if (!seenBullet) intro.push(trimmed);
    else closing.push(trimmed);
  });
  const used = new Set();
  const required = specs.map((spec) => {
    const index = cards.findIndex((card, cardIndex) => !used.has(cardIndex) && spec.title.test(bulletTitle(card)));
    if (index < 0) return `- ${spec.line}`;
    used.add(index);
    const card = cards[index].replace(/^•\s+/, '- ');
    if (spec.phrase.test(card)) return card;
    const base = card.replace(/[.!?]+\s*$/, '');
    return `${base}. ${spec.extra}`;
  });
  const extras = cards.filter((_, index) => !used.has(index)).map((card) => card.replace(/^•\s+/, '- '));
  return [intro.join('\n\n'), [...required, ...extras].join('\n'), closing.join('\n\n')]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

function cleanEmailBody(value) {
  return text(value).replace(/\*\*/g, '').replace(/\s+\n/g, '\n').trim();
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function emailHtml(subject, body) {
  const lines = cleanEmailBody(body).split('\n');
  const parts = [];
  let items = [];
  const flush = () => {
    if (!items.length) return;
    parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;">${items.join('')}</table>`);
    items = [];
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^-\s*:?\s*$/.test(trimmed)) {
      flush();
      return;
    }
    if (/^[-•]\s+/.test(trimmed)) {
      const item = escapeHtml(trimmed.replace(/^[-•]\s+/, ''));
      const bits = item.split(/:\s+/);
      const title = bits.length > 1 ? bits[0] : '';
      const detail = bits.length > 1 ? bits.slice(1).join(': ') : item;
      if (!title && !detail) return;
      items.push(`<tr><td style="padding:0 0 10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EMAIL_BRAND.border};border-radius:10px;background:#f8fafc;">
          <tr><td style="padding:14px 16px;font-family:${EMAIL_FONT.body};">
            ${title ? `<div style="font-size:14px;font-weight:700;color:${EMAIL_BRAND.heading};line-height:1.4;">${title}</div>` : ''}
            ${detail ? `<div style="margin-top:${title ? '4px' : '0'};font-size:14px;line-height:1.55;color:${EMAIL_BRAND.body};">${detail}</div>` : ''}
          </td></tr>
        </table>
      </td></tr>`);
      return;
    }
    flush();
    parts.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${EMAIL_BRAND.body};font-family:${EMAIL_FONT.body};">${escapeHtml(trimmed)}</p>`);
  });
  flush();
  const signupUrl = `${appBaseUrl()}/sign-up`;
  const innerHtml = `
    ${parts.join('') || `<p style="margin:0;font-size:15px;line-height:1.6;color:${EMAIL_BRAND.body};">${escapeHtml(body)}</p>`}
    <p style="margin:22px 0 0;">
      <a href="${escapeHtml(signupUrl)}" style="display:inline-block;background:#0a6b3a;color:#ffffff !important;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;font-family:${EMAIL_FONT.body};">Join Nesti</a>
    </p>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.55;color:${EMAIL_BRAND.muted};font-family:${EMAIL_FONT.body};">
      Or open this link: <a href="${escapeHtml(signupUrl)}" style="color:#0a6b3a;font-weight:600;">${escapeHtml(signupUrl)}</a>
    </p>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.55;color:${EMAIL_BRAND.muted};font-family:${EMAIL_FONT.body};">
      Reply to this email if you want a walkthrough before you join.
    </p>`;
  return renderBrandedEmailShell({
    kicker: 'Nesti',
    title: escapeHtml(subject || 'Your next step with Nesti'),
    innerHtml,
    headerFrom: '#0a6b3a',
    headerTo: '#004b25',
    maxWidth: 600,
  });
}

function fallbackEmail({ name, audience, services, plans }) {
  const who = name || 'there';
  const roleLabel = audience === 'client' ? 'buying or selling a home' : `your work as a ${audience.replaceAll('_', ' ')}`;
  return {
    subject: 'A Nesti plan for your next step',
    body: ensureServiceCards(`Hi ${who},\n\nNesti can help with ${roleLabel}. ${services}\n\nPlans you can start:\n${plans.split('\n').map((line) => `- ${line}`).join('\n')}\n\nCreate an account and start the subscription that fits. A specialist can walk you through it if you reply to this email.`, audience),
  };
}

async function loadLead(id) {
  const row = await EnterpriseInquiry.findById(id);
  if (!row || !['demo', 'contact', 'landing_chat', 'direct_inquiry'].includes(row.source || '')) return null;
  return row;
}

function chatTranscript(row) {
  return (row.transcript || [])
    .slice(-12)
    .map((item) => `${item.role}: ${text(item.text).split('###META###')[0]}`)
    .filter((line) => line.trim().length > line.indexOf(':') + 1)
    .join('\n');
}

async function readInsights(row, settings) {
  const audience = audienceKey(row.interest_role);
  const services = guideForAudience(settings || {}, audience);
  const plans = planLines(audience);
    const fromRequest = row.source === 'direct_inquiry';
    const chat = fromRequest ? '' : chatTranscript(row);
    const requestNote = [text(row.inquiry_topic) ? `Topic: ${text(row.inquiry_topic)}` : '', text(row.city) ? `City: ${text(row.city)}` : '', text(row.country) ? `Country: ${text(row.country)}` : '', text(row.company_name) ? `Company: ${text(row.company_name)}` : ''].filter(Boolean).join('\n');
    const fallback = fallbackInsights({ audience, services, plans });
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 1400,
      messages: [
        {
          role: 'system',
          content: fromRequest
            ? 'You brief an admin on one written Nesti request. There is no chat. Return only JSON with keys summary, services, plan_fit, next_step. summary is three or four sentences about what this person asked for. services is an array of strings, each "Service name: two sentences", naming only services that match their written requirements. plan_fit is one string, never an object, naming one plan from the list with its price and why it fits their message. next_step is one string. Do not mention a score. Do not say the purchase is complete.'
            : 'You brief an admin on one Nesti sales lead from the homepage conversation. Return only JSON with keys summary, services, plan_fit, next_step. summary is three or four sentences about what this person wants and how Nesti fits. services is an array of strings, each "Service name: two sentences describing how it helps this person". For a professional, include every one of these even if the chat mentioned only one: Chatbot (they create it and place it on their own site or any page), Storefront (their own web page), Voice agent (answers calls), Pipeline (tracks each lead through follow-up), Email marketing (personal campaigns), and Support (notes and client questions). You may add other services that fit. For a client, include matched professionals, progress tracking, budget tools, and support, and do not add the professional modules. plan_fit is one string, never an object, naming one plan from the list with its price and why it fits. next_step is one string. Base the summary on the conversation. Do not mention a score. Do not say the purchase is complete.',
        },
        {
          role: 'user',
          content: `Name: ${text(row.full_name) || 'there'}\nRole: ${audience}\nWhat they said: ${text(row.message) || 'No note.'}\n${requestNote}\nServices for this role: ${services}\nPlans:\n${plans}\n${fromRequest ? 'Written request only. Do not invent a conversation.' : `Conversation:\n${chat || 'No chat saved yet.'}`}`,
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content || '';
    const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
    return {
      summary: plainText(json.summary).slice(0, 1200) || fallback.summary,
      services: Array.isArray(json.services) ? json.services.map((item) => plainText(item)).filter(Boolean).slice(0, 12) : fallback.services,
      plan_fit: plainText(json.plan_fit).slice(0, 500) || fallback.plan_fit,
      next_step: plainText(json.next_step).slice(0, 400) || fallback.next_step,
    };
  } catch (error) {
    logger.warn('Admin lead insight used the role template', { error: error?.message });
    return fallback;
  }
}

async function readEmail({ row, insight, instruction = '', currentSubject = '', currentBody = '' }) {
  const audience = audienceKey(row.interest_role);
  const settings = await loadLandingChatSettings().catch(() => null);
  const services = guideForAudience(settings || {}, audience);
  const plans = planLines(audience);
  const { botName } = landingBotIdentity(settings || {});
  const persona = personalityFor(settings?.personality);
  const register = formalityFor(settings?.formality);
  const fallback = fallbackEmail({ name: text(row.full_name), audience, services, plans });
  const serviceLines = (insight?.services || []).map((line) => `- ${line}`).join('\n');
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 1800,
      messages: [
        {
          role: 'system',
          content: `You are ${botName} at Nesti. ${persona.directive} ${register.directive} Write the subscription email in that voice. Return only JSON with keys subject and body. Body is plain text. Open with their name and one paragraph that acknowledges their situation from the insight summary. Then one line per service, each starting with "- ", then the service name, a colon, and two sentences. For a professional, include all of these lines even when the chat mentioned only one: Chatbot, Storefront, Voice agent, Pipeline, Email marketing, and Support. The chatbot line must say they can place it on their own site or any page. The storefront line must say it is their own web page. The voice agent line must describe answering calls. The pipeline line must describe tracking each lead through follow-up. The email marketing line must describe personal campaigns. The support line must describe the support module for notes and client questions. You may add other relevant service lines after these. For a client, include matched professionals, progress tracking, budget tools, and support, and do not add those professional modules. Then a short paragraph that names the recommended plan, its price, and why it fits. Close by inviting them once to create an account and start that subscription. Never use asterisks or markdown. Do not mention a score. Do not say the purchase is complete. If a revision note is present, revise the current email to follow it, keep the same person, and still include every required service line.`,
        },
        {
          role: 'user',
          content: `Name: ${text(row.full_name) || 'there'}\nRole: ${audience}\nInsight summary: ${text(insight?.summary)}\nServices:\n${serviceLines || services}\nPlan fit: ${text(insight?.plan_fit)}\nNext step: ${text(insight?.next_step)}\nPlan list:\n${plans}\nConversation:\n${chatTranscript(row) || 'No chat saved.'}\nRevision note: ${text(instruction) || 'None.'}\nCurrent subject: ${text(currentSubject) || 'None.'}\nCurrent email:\n${cleanEmailBody(currentBody) || 'None yet.'}`,
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content || '';
    const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
    return {
      subject: text(json.subject).slice(0, 200) || fallback.subject,
      body: ensureServiceCards(cleanEmailBody(json.body), audience).slice(0, 6000) || fallback.body,
    };
  } catch (error) {
    logger.warn('Admin lead email draft used the role template', { error: error?.message });
    return fallback;
  }
}

function assignEmailDraft(row, subject, body, origin) {
  row.email_draft = {
    subject: text(subject).slice(0, 200),
    body: cleanEmailBody(body).slice(0, 6000),
    origin: origin === 'manual' ? 'manual' : 'auto',
    updated_at: new Date(),
  };
}

export async function draftAdminLeadEmailService(id, input = {}) {
  const row = await loadLead(id);
  if (!row) return fail(404, 'Admin lead not found.');
  if (!text(row.email)) return fail(400, 'This lead has no email address.');
  const settings = await loadLandingChatSettings().catch(() => null);
  const insight = row.insights?.summary ? row.insights : await readInsights(row, settings);
  if (!row.insights?.summary) {
    row.insights = { ...insight, generated_at: new Date() };
  }
  const drafted = await readEmail({
    row,
    insight,
    instruction: text(input.instruction).slice(0, 800),
    currentSubject: text(input.subject).slice(0, 200),
    currentBody: cleanEmailBody(input.body).slice(0, 6000),
  });
  assignEmailDraft(row, drafted.subject, drafted.body, 'auto');
  await row.save();
  return ok({ subject: row.email_draft.subject, body: row.email_draft.body, to_email: text(row.email) });
}

const followUpQueue = new Map();

export function queueAdminLeadFollowUp(id) {
  const key = String(id || '');
  if (!key) return;
  if (followUpQueue.has(key)) {
    followUpQueue.set(key, 'again');
    return;
  }
  followUpQueue.set(key, 'run');
  const run = async () => {
    try {
      await prepareAdminLeadFollowUp(key);
    } catch (error) {
      logger.warn('Admin lead follow-up was not prepared', { error: error?.message });
    } finally {
      if (followUpQueue.get(key) === 'again') {
        followUpQueue.set(key, 'run');
        await run();
        return;
      }
      followUpQueue.delete(key);
    }
  };
  void run();
}

export async function prepareAdminLeadFollowUp(id) {
  const row = await loadLead(id);
  if (!row || !text(row.email)) return null;
  const settings = await loadLandingChatSettings().catch(() => null);
  const insight = await readInsights(row, settings);
  row.insights = { ...insight, generated_at: new Date() };
  const hasDraft = text(row.email_draft?.subject) || text(row.email_draft?.body);
  if (!hasDraft || row.email_draft?.origin === 'auto') {
    const drafted = await readEmail({ row, insight });
    assignEmailDraft(row, drafted.subject, drafted.body, 'auto');
  }
  await row.save();
  const { emitAdminPlatformLead } = await import('../realtime/workspaceSocket.js');
  emitAdminPlatformLead({
    kind: 'admin_lead_updated',
    inquiry_id: String(row._id),
    href: `/admin/leads/detail/${row._id}`,
  });
  return row;
}

export async function saveAdminLeadEmailDraftService(id, input = {}) {
  const row = await loadLead(id);
  if (!row) return fail(404, 'Admin lead not found.');
  const subject = text(input.subject).slice(0, 200);
  const body = cleanEmailBody(input.body).slice(0, 6000);
  if (!subject && !body) return ok({ subject: '', body: '' });
  assignEmailDraft(row, subject, body, 'manual');
  await row.save();
  return ok({ subject: row.email_draft.subject, body: row.email_draft.body, updated_at: row.email_draft.updated_at });
}

export async function sendAdminLeadEmailService(id, body) {
  const row = await loadLead(id);
  if (!row) return fail(404, 'Admin lead not found.');
  const to = text(row.email);
  const subject = text(body?.subject).slice(0, 200);
  const message = cleanEmailBody(body?.body).slice(0, 6000);
  if (!to) return fail(400, 'This lead has no email address.');
  if (!subject || !message) return fail(400, 'Subject and message are required.');
  row.guide_emails = row.guide_emails || [];
  let attempt = [...row.guide_emails].reverse().find((item) => (
    item.status === 'sending'
    && item.to_email === to
    && item.subject === subject
    && item.body === message
    && item.idempotency_key
  ));
  if (!attempt) {
    attempt = {
      to_email: to,
      subject,
      body: message,
      type: 'manual',
      status: 'sending',
      idempotency_key: crypto.randomUUID(),
      sent_at: new Date(),
    };
    row.guide_emails.push(attempt);
    await row.save();
  }
  const result = await salesEmailDeps.sendEmail({
    email: to,
    subject,
    message,
    htmlMessage: emailHtml(subject, message),
    idempotencyKey: attempt.idempotency_key,
  });
  attempt.status = result?.success ? 'sent' : 'failed';
  if (result?.success) {
    attempt.sent_at = new Date();
    assignEmailDraft(row, subject, message, row.email_draft?.origin === 'manual' ? 'manual' : 'auto');
  }
  await row.save();
  if (!result?.success) return fail(502, 'The email could not be sent. The attempt has been recorded.');
  return ok({
    sent: true,
    guide_emails: row.guide_emails.map((item) => ({
      to_email: item.to_email,
      subject: item.subject,
      body: item.body,
      type: item.type || 'manual',
      status: item.status,
      sent_at: item.sent_at,
    })),
  });
}

function fallbackInsights({ audience, services, plans }) {
  return {
    summary: `This ${audience.replaceAll('_', ' ')} is not on a plan yet. The next step is a subscription that matches the work they described.`,
    services: serviceCardsFor(audience).map((card) => card.line),
    plan_fit: plans.split('\n')[1] || plans.split('\n')[0] || 'Start with the middle plan.',
    next_step: 'Send the nurture email, then ask them to create an account and start the subscription.',
  };
}

export async function insightAdminLeadService(id) {
  const row = await loadLead(id);
  if (!row) return fail(404, 'Admin lead not found.');
  const settings = await loadLandingChatSettings().catch(() => null);
  const insight = await readInsights(row, settings);
  row.insights = { ...insight, generated_at: new Date() };
  await row.save();
  return ok({ insights: row.insights });
}

export async function closeAdminLeadService(id, body) {
  const row = await loadLead(id);
  if (!row) return fail(404, 'Admin lead not found.');
  const outcome = text(body?.outcome).toLowerCase();
  if (outcome !== 'won' && outcome !== 'lost') return fail(400, 'Choose won or lost.');
  if (outcome === 'won') {
    let user = row.user_id
      ? await User.findById(row.user_id).select('_id').lean()
      : null;
    if (!user && text(row.email)) {
      user = await User.findOne({ email: text(row.email) })
        .collation({ locale: 'en', strength: 2 })
        .select('_id')
        .lean();
    }
    if (!user?._id) return fail(409, 'A lead can be marked joined only after a linked account subscribes.');
    const [professionalSubscription, clientSubscription] = await Promise.all([
      Subscription.exists({ user_id: user._id, status: { $in: ['free_trial', 'trialing', 'active', 'past_due'] } }),
      ClientSubscription.exists({ user_id: user._id, status: { $in: ['trialing', 'active', 'past_due'] } }),
    ]);
    if (!professionalSubscription && !clientSubscription) {
      return fail(409, 'A lead can be marked joined only after a linked account subscribes.');
    }
  }
  row.close_outcome = outcome;
  row.close_note = text(body?.note).slice(0, 1000);
  row.closed_at = new Date();
  row.status = 'resolved';
  if (outcome === 'won') row.pipeline_stage = 'ready';
  await row.save();
  const { emitAdminPlatformLead } = await import('../realtime/workspaceSocket.js');
  emitAdminPlatformLead({
    schema: 1,
    kind: 'admin_lead_updated',
    inquiry_id: String(row._id),
    stage: outcome === 'lost' ? 'closed' : 'ready',
    close_outcome: row.close_outcome,
    href: `/admin/leads/detail/${row._id}`,
  });
  return ok({
    close_outcome: row.close_outcome,
    close_note: row.close_note,
    closed_at: row.closed_at,
    stage: outcome === 'lost' ? 'closed' : 'ready',
  });
}
