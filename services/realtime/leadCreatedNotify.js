import User from '../../models/User.js';
import sendEmail, { isResendConfigured } from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { emitNotification } from './workspaceSocket.js';
import {
  createLeadCreatedNotification,
  createLeadLifecycleNotification,
} from '../notifications/notificationService.js';
import { recordLeadKpiEvent } from '../analytics/leadKpiService.js';
import {
  urgencyWindowLabel,
  buildSpeedToLeadTip,
  severityFromConversionPreview,
  conversionPreviewBody,
  primaryNextActionFromPreview,
} from '../lead/leadExperienceContract.js';
import { EMAIL_BRAND, renderBrandedEmailShell } from '../email/emailTheme.js';
import {
  BROKER_INVESTMENT_TYPES,
  borrowerEntityLabel,
  investorFinancingLabel,
  marketSummary,
} from '../professionalAssistant/brokerInvestorMarket.js';

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function humanizeToken(value) {
  const text = String(value || '').trim().replace(/_/g, ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}
function timelineLabel(value) {
  const text = String(value || '').trim().replace(/(\d)_(\d)/g, '$1–$2').replace(/_/g, ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function usdRangePart(part) {
  const p = String(part || '').trim().toLowerCase();
  if (/^\d+(\.\d+)?k$/.test(p)) return `$${p}`;
  if (/^\d+(\.\d+)?m$/.test(p)) return `$${p.slice(0, -1)}M`;
  if (/^\d+(\.\d+)?$/.test(p)) return `$${Number(p).toLocaleString('en-US')}`;
  return '';
}

function usdLabel(value) {
  const text = String(value ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(text.replace(/,/g, ''))) {
    return `$${Number(text.replace(/,/g, '')).toLocaleString('en-US')}`;
  }
  const token = text.toLowerCase();
  let m = token.match(/^([\d.]+[km]?)_(?:to_)?([\d.]+[km]?)$/);
  if (m && usdRangePart(m[1]) && usdRangePart(m[2])) return `${usdRangePart(m[1])}–${usdRangePart(m[2])}`;
  m = token.match(/^(?:under|below|less_than)_([\d.]+[km]?)$/);
  if (m && usdRangePart(m[1])) return `Under ${usdRangePart(m[1])}`;
  m = token.match(/^([\d.]+[km]?)_?(?:plus|\+)$/);
  if (m && usdRangePart(m[1])) return `${usdRangePart(m[1])}+`;
  return text;
}

const VIA_COMPANY_LABELS = { personally: 'Personally', company: 'Through a company', not_sure: 'Not sure yet' };
const INQUIRY_EMAIL_TYPES = new Set(['lawyer_inquiry', 'mortgage_broker_inquiry', 'agent_inquiry', 'public_web_form', 'chat_lead']);
const ROLE_LABELS = { agent: 'Agent', mortgage_broker: 'Mortgage broker', lawyer: 'Lawyer' };
const DETAIL_ROLE_BY_TYPE = { lawyer_inquiry: 'lawyer', mortgage_broker_inquiry: 'mortgage_broker', agent_inquiry: 'agent' };

export function newLeadEmailSubject({ newLeadMatch = null, persistedGrade = '', details = null } = {}) {
  const d = details && typeof details === 'object' ? details : {};
  const cf = newLeadMatch?.compatibility_factors || {};
  const role = ROLE_LABELS[d.professional_type || DETAIL_ROLE_BY_TYPE[d.type] || cf.professional_type] || '';
  const grade = humanizeToken(persistedGrade || 'interested');
  const leadType = String(newLeadMatch?.lead_type || '').trim();
  const kind = leadType && leadType !== 'unknown'
    ? humanizeToken(leadType.toLowerCase())
    : `${grade}${d.client_type === 'investor' ? ' investor' : ''}`;
  const name = String(d.client_name || cf.contact?.name || '').trim().slice(0, 60);
  return `New ${kind} lead${name ? `: ${name}` : ''}${role ? ` (${role})` : ''} — Nesti`;
}
const INTENT_LABELS = { buy: 'Buying', sell: 'Selling', client: 'Client' };

export function inquiryEmailDetailRows(details = null) {
  const d = details && typeof details === 'object' ? details : {};
  if (!INQUIRY_EMAIL_TYPES.has(String(d.type || ''))) return [];
  const country = String(d.market_country || '').toUpperCase();
  const investor = String(d.client_type || '').toLowerCase() === 'investor'
    || String(d.purchase_purpose || '').toLowerCase() === 'investment';
  const ownsInvestments = String(d.owns_investments || '').toLowerCase();
  const rows = [
    ['Client', d.client_name],
    ['Email', d.client_email],
    ['Phone', d.client_phone],
    ['Looking to', INTENT_LABELS[String(d.intent || '').toLowerCase()] || ''],
    ['Client type', investor ? 'Investor' : ''],
    ['Location', d.preferred_location || d.property_address || ''],
    ['Timeline', timelineLabel(d.timeline || d.mortgage_timeline || d.closing_timeline)],
    ['Purchasing as', VIA_COMPANY_LABELS[d.via_company] || humanizeToken(d.via_company)],
    ['Investment type', BROKER_INVESTMENT_TYPES[d.investment_type] || humanizeToken(d.investment_type)],
    ['Owns other investment properties', ownsInvestments === 'yes' ? 'Yes' : ownsInvestments === 'no' ? 'No' : humanizeToken(ownsInvestments)],
    ['Financing path', investorFinancingLabel(d.investment_financing, country) || humanizeToken(d.investment_financing)],
    ['Borrowing as', borrowerEntityLabel(d.borrower_entity, country) || humanizeToken(d.borrower_entity)],
    ['Transaction type', humanizeToken(d.transaction_type)],
    ['Legal service', humanizeToken(d.legal_services_needed)],
    ['Market', marketSummary({ market_country: d.market_country, market_region: d.market_region, market_city: d.market_city, market_country_name: d.market_country_name })],
    [d.professional_type === 'lawyer' || d.type === 'lawyer_inquiry' ? 'Property value (USD)' : 'Budget (USD)', usdLabel(d.budget || d.property_budget || d.property_value)],
    ['Message', String(d.message || d.inquiry_message || '').trim().slice(0, 600)],
    ['Photos', d.photos_note],
  ];
  return rows
    .map(([label, value]) => [label, String(value ?? '').trim()])
    .filter(([, value]) => value);
}

function inquiryEmailDetailsHtml(rows = []) {
  if (!rows.length) return '';
  const body = rows
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;font-size:12px;font-weight:700;color:#4A5568;white-space:nowrap;vertical-align:top;">${escapeEmailHtml(label)}</td><td style="padding:4px 0;font-size:13px;color:#1A202C;">${escapeEmailHtml(value)}</td></tr>`)
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border-collapse:collapse;">${body}</table>`;
}

function envTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

const KPI_LIFECYCLE_TYPE_MAP = {
  lead_lifecycle: 'lead_updated',
  lead_updated: 'lead_updated',
  appointment_booked: 'appointment_booked',
  consultation_booked: 'appointment_booked',
  appointment_canceled: 'appointment_canceled',
  nurture_appointment_booked: 'appointment_booked',
};

export async function emitNewLeadCreatedNotification(ownerUserId, ctx) {
  let notification_id = null;
  try {
    const doc = await createLeadCreatedNotification(ownerUserId, ctx);
    notification_id = doc?._id ? String(doc._id) : null;
  } catch (e) {
    logger.warn('Lead-created notification persist failed', { error: e.message, user_id: String(ownerUserId) });
  }

  const {
    newLeadMatch,
    conversationId,
    sessionId,
    persistedGrade,
    finalScore,
    socketIntent,
    appointment_status,
    conversion_preview,
    details = null,
  } = ctx;

  emitNotification(ownerUserId, {
    notification_id,
    notification_type: 'lead_created',
    title: `New ${String(persistedGrade || 'lead')} lead`,
    body: conversionPreviewBody(conversion_preview),
    severity: severityFromConversionPreview(conversion_preview),
    lead_match_id: String(newLeadMatch._id),
    lead_profile_id: newLeadMatch.lead_profile_id ? String(newLeadMatch.lead_profile_id) : null,
    conversation_id: conversationId ? String(conversationId) : null,
    session_id: sessionId || null,
    grade: persistedGrade,
    score: Number(newLeadMatch.match_score ?? finalScore),
    intent: socketIntent,
    appointment_status,
    urgency: conversion_preview?.urgency ?? null,
    urgency_window: urgencyWindowLabel(conversion_preview),
    speed_to_lead_tip: buildSpeedToLeadTip(persistedGrade, conversion_preview),
    outcomes_headline: conversion_preview?.outcomes_headline ?? null,
    booking_cta: conversion_preview?.booking_cta ?? null,
    primary_next_action: primaryNextActionFromPreview(conversion_preview),
    action: { type: 'open_lead', lead_match_id: String(newLeadMatch._id) },
    details,
  });

  try {
    await recordLeadKpiEvent({
      user_id: ownerUserId,
      lead_match_id: newLeadMatch._id,
      conversation_id: conversationId || null,
      event_type: 'lead_created',
      grade: persistedGrade || null,
      appointment_status: appointment_status || null,
      urgency: conversion_preview?.urgency ?? null,
      metadata: {
        score: Number(newLeadMatch.match_score ?? finalScore),
        intent: socketIntent || null,
      },
    });
  } catch (e) {
    logger.warn('Lead KPI event write failed (lead_created)', { error: e.message });
  }
}

export async function emitLeadLifecycleNotification(ownerUserId, payload) {
  let notification_id = null;
  try {
    const doc = await createLeadLifecycleNotification(ownerUserId, payload);
    notification_id = doc?._id ? String(doc._id) : null;
  } catch (e) {
    logger.warn('Lead-lifecycle notification persist failed', {
      error: e.message,
      user_id: String(ownerUserId),
    });
  }

  emitNotification(ownerUserId, { notification_id, ...payload });

  try {
    await recordLeadKpiEvent({
      user_id: ownerUserId,
      lead_match_id: payload?.lead_match_id || null,
      conversation_id: payload?.conversation_id || null,
      event_type: KPI_LIFECYCLE_TYPE_MAP[payload?.notification_type] || payload?.notification_type || 'lead_updated',
      grade: payload?.grade || null,
      appointment_status: payload?.appointment_status || null,
      urgency: payload?.urgency || null,
      metadata: {
        severity: payload?.severity || null,
        title: payload?.title || null,
        booked_via_nurture: payload?.booked_via_nurture ?? false,
      },
    });
  } catch (e) {
    logger.warn('Lead KPI event write failed (lifecycle)', { error: e.message });
  }
}

export async function sendNewLeadCreatedEmailIfEnabled(ownerUserId, ctx) {
  if (!envTruthy(process.env.NEW_LEAD_EMAIL_NOTIFICATIONS)) return;
  const { assistantAllowsLeadEmail } = await import('../professionalAssistant/professionalAssistantService.js');
  if (!(await assistantAllowsLeadEmail(ownerUserId))) return;
  if (!isResendConfigured()) {
    logger.debug('NEW_LEAD_EMAIL_NOTIFICATIONS enabled but Resend is not configured');
    return;
  }

  const { newLeadMatch, persistedGrade, conversion_preview, details = null } = ctx;
  const summary = conversionPreviewBody(conversion_preview);
  const detailRows = inquiryEmailDetailRows(details);
  const detailText = detailRows.length
    ? `\n\n${detailRows.map(([label, value]) => `${label}: ${value}`).join('\n')}`
    : '';

  try {
    const user = await User.findById(ownerUserId).select('email first_name').lean();
    if (!user?.email) return;

    const result = await sendEmail({
      email: user.email,
      subject: newLeadEmailSubject({ newLeadMatch, persistedGrade, details }),
      message: `${summary}${detailText}\n\nOpen your dashboard to follow up.\nLead ID: ${String(newLeadMatch._id)}`,
      htmlMessage: renderBrandedEmailShell({
        kicker: 'Nesti Workspace',
        title: 'New lead alert',
        maxWidth: 560,
        innerHtml: `
          <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4A5568;">${escapeEmailHtml(summary)}</p>
          ${inquiryEmailDetailsHtml(detailRows)}
          <div style="margin:0 0 14px;padding:12px 14px;border:1px solid #bdecc8;background:#f2fff6;border-radius:10px;">
            <div style="font-size:12px;font-weight:700;color:${EMAIL_BRAND.primaryDark};letter-spacing:0.06em;text-transform:uppercase;">Lead ID</div>
            <div style="margin-top:4px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;color:#1f8b3d;">${String(newLeadMatch._id)}</div>
          </div>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#718096;">Open your dashboard to review the lead and follow up quickly.</p>`,
      }),
    });
    if (!result.success) {
      logger.warn('New lead email notification send failed', { lead_match_id: String(newLeadMatch._id) });
    }
  } catch (e) {
    logger.warn('New lead email notification error', { error: e.message });
  }
}
