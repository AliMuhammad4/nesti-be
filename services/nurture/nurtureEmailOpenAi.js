import OpenAI from 'openai';
import logger from '../../utils/logger.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

let _openaiClient = null;
function getOpenAI() {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}

const MODEL = 'gpt-4o-mini';
const MAX_SUBJECT = 200;
const MAX_BODY_TEXT = 8000;
const MAX_BODY_HTML = 20000;
const MAX_TOKENS = 1400;

function profTypeFromLead(leadMatch) {
  return leadMatch?.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
}

function normalizeProfessionalType(raw) {
  const role = String(raw || '').trim().toLowerCase();
  if (role === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  if (role === PROFESSIONAL_TYPE.AGENT) return PROFESSIONAL_TYPE.AGENT;
  return null;
}

function qualificationSlice(profile, profType) {
  const p = profile || {};
  if (profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    const q = p.qualification?.mortgage_broker || {};
    return {
      mortgage_timeline: q.mortgage_timeline || null,
      pre_approval_status: q.pre_approval_status || q.mortgage_status || null,
      purchase_purpose: q.purchase_purpose || null,
      urgency_signal: q.urgency_signal || null,
      credit_score_range: q.credit_score_range || null,
      employment_status: q.employment_status || null,
      household_income: q.household_income || null,
      down_payment_readiness: q.down_payment_readiness || null,
      property_budget: q.property_budget || null,
    };
  }
  if (profType === PROFESSIONAL_TYPE.LAWYER) {
    const q = p.qualification?.lawyer || {};
    return {
      transaction_stage: q.transaction_stage || null,
      closing_timeline: q.closing_timeline || null,
      transaction_type: q.transaction_type || null,
      property_value: q.property_value || null,
      mortgage_status: q.mortgage_status || null,
      realtor_involved: q.realtor_involved || null,
      first_time_buyer: q.first_time_buyer || null,
      legal_services_needed: q.legal_services_needed || null,
    };
  }
  const q = p.qualification?.agent || {};
  return {
    mortgage_status: q.mortgage_status || null,
    realtor_status: q.realtor_status || null,
    viewing_readiness: q.viewing_readiness || null,
    urgency_readiness: q.urgency_readiness || null,
    motivation_reason: q.motivation_reason || null,
    living_situation: q.living_situation || null,
  };
}

/** Marker before server-appended closing HTML (scheduling + signature). Email clients ignore HTML comments. */
export const NURTURE_FOOTER_HTML_MARKER = '<!-- nesti:nurture-footer -->';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hrefEscape(url) {
  return String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Strip AI placeholder sign-offs; trim trailing junk before server footer is applied.
 */
function stripAiPlaceholderSignoff(body_text, body_html) {
  let text = String(body_text || '').trim();
  let html = String(body_html || '').trim();
  text = text
    .replace(/\n*\[Your Name\][^\n]*/gi, '')
    .replace(/\n*\[Your Contact Information\][^\n]*/gi, '')
    .replace(/\n*Best regards,\s*$/i, '')
    .replace(/\n+Best,?\s*$/i, '')
    .replace(/\n+Thanks,?\s*$/i, '')
    .replace(/\n+Thank you,?\s*$/i, '')
    .replace(/\n+Cheers,?\s*$/i, '')
    .replace(/\n+Sincerely,?\s*$/i, '')
    .trim();
  html = html
    .replace(/<p>\s*\[Your Name\]\s*<\/p>/gi, '')
    .replace(/<p>\s*\[Your Contact Information\]\s*<\/p>/gi, '')
    .replace(/<p>\s*Best regards,?\s*<\/p>\s*$/i, '')
    .trim();
  return { body_text: text, body_html: html };
}

/**
 * Append scheduling link + professional signature to draft bodies (single combined body_html for email clients).
 * @param {{ calendly_url?: string | null, signature?: { display_name?: string, email?: string | null, phone?: string | null } | null }} meta
 */
export function finalizeNurtureDraftBody(draft, meta = {}) {
  const calendly_url = meta.calendly_url != null && String(meta.calendly_url).trim() ? String(meta.calendly_url).trim() : '';
  const sig = meta.signature || {};
  const display_name = String(sig.display_name || '').trim();
  const email = sig.email != null && String(sig.email).trim() ? String(sig.email).trim() : '';
  const phone = sig.phone != null && String(sig.phone).trim() ? String(sig.phone).trim() : '';

  let { subject, body_text, body_html } = { ...draft };
  const footerStart = body_html.indexOf(NURTURE_FOOTER_HTML_MARKER);
  if (footerStart !== -1) {
    body_html = body_html.slice(0, footerStart).trim();
  }
  ({ body_text, body_html } = stripAiPlaceholderSignoff(body_text, body_html));

  const textParts = [];
  const htmlParts = [NURTURE_FOOTER_HTML_MARKER];

  if (calendly_url) {
    textParts.push(`Book a time that works for you: ${calendly_url}`);
    htmlParts.push(
      `<p>Book a time that works for you: <a href="${hrefEscape(calendly_url)}">Schedule a call</a>.</p>`,
    );
  }

  if (display_name || email || phone) {
    const lines = ['Best regards,'];
    if (display_name) lines.push(display_name);
    if (email) lines.push(email);
    if (phone) lines.push(phone);
    textParts.push(lines.join('\n'));
    const htmlLines = [
      'Best regards,',
      display_name ? `<strong>${escapeHtml(display_name)}</strong>` : '',
      email ? escapeHtml(email) : '',
      phone ? escapeHtml(phone) : '',
    ].filter((line, idx) => idx === 0 || line);
    htmlParts.push(`<p>${htmlLines.join('<br/>')}</p>`);
  }

  if (textParts.length) {
    body_text = `${body_text.trim()}\n\n${textParts.join('\n\n')}`.trim();
  }
  if (htmlParts.length > 1) {
    body_html = `${body_html.trim()}\n${htmlParts.join('\n')}`.trim();
  }

  return { subject, body_text, body_html };
}

/**
 * Compact, factual context for nurture emails (no full chat transcript).
 */
function compactMixed(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  try {
    const o = JSON.parse(JSON.stringify(value));
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const keys = Object.keys(o);
      if (keys.length > 24) {
        const trimmed = {};
        keys.slice(0, 20).forEach((k) => {
          trimmed[k] = o[k];
        });
        return trimmed;
      }
    }
    return o;
  } catch {
    return null;
  }
}

function normalizePropertyMatchesForContext(pm) {
  if (!pm || typeof pm !== 'object') return null;
  const listings = Array.isArray(pm.listings) ? pm.listings : [];
  const context = pm.context ?? null;
  const note = pm.note != null && String(pm.note).trim() ? String(pm.note).trim() : null;
  if (!listings.length && !context && !note) return null;
  return { context, note, listings };
}

/**
 * @param {{
 *   property_matches?: { listings?: unknown[], context?: string | null, note?: string | null },
 *   referral_context?: {
 *     source_professional_name?: string | null,
 *     source_professional_role?: string | null,
 *     referral_notes?: string | null,
 *   } | null,
 * }} [extras]
 */
export function buildLeadContext(leadMatch, profile, conversation, extras = {}) {
  const isReferralNurture =
    Boolean(extras?.is_referral_nurture) || Boolean(extras?.referral_context);
  const viewerRole = isReferralNurture
    ? normalizeProfessionalType(extras?.viewer_professional_role)
    : null;
  const referralActionRole = normalizeProfessionalType(extras?.referral_context?.action_professional_role);
  const referralTargetRole = normalizeProfessionalType(extras?.referral_context?.target_professional_role);
  const profType = viewerRole || referralActionRole || referralTargetRole || profTypeFromLead(leadMatch);
  const grade = String(leadMatch?.lead_type || '').split('_')[0] || null;
  const prop = profile?.property || {};
  const bp = profile?.budget_profile || {};
  const cf = leadMatch?.compatibility_factors?.contact || {};
  return {
    professional_type: profType,
    lead_grade: grade,
    match_score: leadMatch?.match_score != null ? Number(leadMatch.match_score) : null,
    match_status: leadMatch?.match_status || null,
    lead_match_meta: {
      contact_count: leadMatch?.contact_count != null ? Number(leadMatch.contact_count) : null,
      first_contact_at: leadMatch?.first_contact_at
        ? new Date(leadMatch.first_contact_at).toISOString()
        : null,
      last_contact_at: leadMatch?.last_contact_at
        ? new Date(leadMatch.last_contact_at).toISOString()
        : null,
    },
    intent: profile?.intent || conversation?.intent || null,
    intent_summary: profile?.intent_summary
      ? {
          primary_intent: profile.intent_summary.primary_intent || null,
          buy_count: profile.intent_summary.buy_count ?? null,
          sell_count: profile.intent_summary.sell_count ?? null,
        }
      : null,
    contact: {
      first_name: (profile?.identity?.full_name || '').split(/\s+/)[0] || null,
      full_name: profile?.identity?.full_name || null,
      preferred_contact_method: profile?.contact_preferences?.preferred_contact_method || null,
      best_time_to_contact: profile?.contact_preferences?.best_time_to_contact || null,
      lead_email_on_file: profile?.identity?.email || profile?.identity?.canonical_email || null,
      lead_phone_on_file: profile?.identity?.phone || profile?.identity?.canonical_phone || cf.phone || null,
    },
    property: {
      location: prop.location || null,
      address: prop.address || null,
      budget: prop.budget || prop.expected_price || bp.latest_budget_text || null,
      timeline: prop.timeline || null,
      bedrooms: prop.bedrooms ?? null,
      bathrooms: prop.bathrooms ?? null,
      square_footage: prop.square_footage || null,
      property_type: prop.property_type || null,
      must_have_features: prop.must_have_features || null,
      parking_required: prop.parking_required || null,
      backyard_needed: prop.backyard_needed || null,
      school_district_important: prop.school_district_important || null,
    },
    budget_numbers:
      bp.min_budget != null || bp.max_budget != null
        ? {
            min_budget: bp.min_budget != null ? Number(bp.min_budget) : null,
            max_budget: bp.max_budget != null ? Number(bp.max_budget) : null,
            currency: bp.currency || null,
            confidence: bp.confidence || null,
          }
        : null,
    qualification: qualificationSlice(profile, profType),
    scoring: profile?.scoring
      ? {
          current_grade: profile.scoring.current_grade || null,
          current_score:
            profile.scoring.current_score != null ? Number(profile.scoring.current_score) : null,
          score_trend: profile.scoring.score_trend || null,
        }
      : null,
    icp_fit: leadMatch?.icp_fit
      ? {
          fit_tier: leadMatch.icp_fit.fit_tier || null,
          fit_score: leadMatch.icp_fit.fit_score != null ? Number(leadMatch.icp_fit.fit_score) : null,
          matched_factors: Array.isArray(leadMatch.icp_fit.matched_factors)
            ? leadMatch.icp_fit.matched_factors.slice(0, 12)
            : null,
          missing_factors: Array.isArray(leadMatch.icp_fit.missing_factors)
            ? leadMatch.icp_fit.missing_factors.slice(0, 12)
            : null,
        }
      : null,
    conversation: conversation
      ? {
          calendly_booking_status: conversation.calendly_booking_status || null,
          intent: conversation.intent || null,
          lead_grade: conversation.lead_grade || null,
          lead_classification: conversation.lead_classification || null,
          lead_score:
            conversation.lead_score != null ? Number(conversation.lead_score) : null,
          is_qualified: conversation.is_qualified ?? null,
          emotional_state: conversation.emotional_state || null,
          lead_reasons_summary: compactMixed(conversation.lead_reasons),
        }
      : null,
    property_matches_email: normalizePropertyMatchesForContext(extras.property_matches),
    referral_context: extras.referral_context
      ? {
          source_professional_name:
            extras.referral_context.source_professional_name != null
              ? String(extras.referral_context.source_professional_name).trim() || null
              : null,
          source_professional_role:
            extras.referral_context.source_professional_role != null
              ? String(extras.referral_context.source_professional_role).trim() || null
              : null,
          target_professional_role:
            extras.referral_context.target_professional_role != null
              ? String(extras.referral_context.target_professional_role).trim() || null
              : null,
          action_professional_role:
            extras.referral_context.action_professional_role != null
              ? String(extras.referral_context.action_professional_role).trim() || null
              : null,
          referral_notes:
            extras.referral_context.referral_notes != null
              ? String(extras.referral_context.referral_notes).trim() || null
              : null,
        }
      : null,
  };
}

function extractJsonObject(raw) {
  const t = String(raw || '').trim();
  const candidates = [];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(t);
  const firstBrace = t.indexOf('{');
  const lastBrace = t.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(t.slice(firstBrace, lastBrace + 1));
  }

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Invalid JSON');
}

export function validateEmailDraft(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Invalid draft shape');
  const subject = String(obj.subject || '').trim().slice(0, MAX_SUBJECT);
  const body_text = String(obj.body_text || obj.body || '').trim().slice(0, MAX_BODY_TEXT);
  let body_html = obj.body_html != null ? String(obj.body_html).trim().slice(0, MAX_BODY_HTML) : '';
  if (!subject) throw new Error('Missing subject');
  if (!body_text) throw new Error('Missing body_text');
  if (!body_html) {
    const esc = body_text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    body_html = `<p>${esc.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`;
  }
  return { subject, body_text, body_html };
}

function plainTextToHtml(bodyText) {
  const esc = String(bodyText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${esc.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`;
}

function compactSubjectPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function meetingPrepHeading(leadContext = {}) {
  const booked =
    String(
      leadContext?.calendly_booking_status
      || leadContext?.conversation?.calendly_booking_status
      || '',
    ).toLowerCase() === 'booked';
  return booked ? 'To make the most of our scheduled meeting' : 'Before our meeting';
}

function buildMeetingPrepLines(profType, leadContext = {}) {
  const qualification = leadContext?.qualification || {};
  const property = leadContext?.property || {};
  const intent = String(leadContext?.intent || leadContext?.intent_summary?.primary_intent || '').toLowerCase();

  if (profType === PROFESSIONAL_TYPE.LAWYER) {
    const lines = ['Government-issued photo ID'];
    const stage = String(qualification.transaction_stage || '').trim();
    if (stage === 'offer_accepted' || stage === 'actively_submitting') {
      lines.push('Signed agreement of purchase and sale (if available)');
    }
    const mortgage = String(qualification.mortgage_status || '').trim();
    if (mortgage && mortgage !== 'still_applying') {
      lines.push('Mortgage commitment or approval letter');
    } else {
      lines.push('Latest mortgage pre-approval or lender contact details (if applicable)');
    }
    lines.push('Any title-related documents already received');
    lines.push('Your target closing date and outstanding questions about adjustments or title insurance');
    return lines.slice(0, 5);
  }

  if (profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    const lines = [
      'Government-issued photo ID',
      'Recent pay stubs or employment confirmation letter',
      'Last two years of tax documents (T4/NOA or equivalent)',
      'Recent bank statements (typically 90 days)',
    ];
    const preApproval = String(qualification.pre_approval_status || qualification.mortgage_status || '').trim();
    if (!preApproval || preApproval === 'not_yet' || preApproval === 'in_progress') {
      lines.push('Estimated down payment source and amount');
    } else {
      lines.push('Questions about rate hold, pre-approval amount, or next documentation step');
    }
    return lines.slice(0, 5);
  }

  const lines = ['Government-issued photo ID'];
  if (intent !== 'sell') {
    const mortgage = String(qualification.mortgage_status || '').trim();
    if (!mortgage || mortgage === 'not_yet' || mortgage === 'in_progress') {
      lines.push('Mortgage pre-approval or pre-qualification letter (if available)');
    } else {
      lines.push('Current financing pre-approval or budget confirmation');
    }
  }
  if (property.must_have_features) {
    lines.push('Updated must-have list and any deal-breakers');
  } else {
    lines.push('Preferred areas, budget range, and must-have features');
  }
  if (intent === 'sell') {
    lines.push('Property details, recent updates, and your ideal closing timeline');
  } else {
    lines.push('Questions about showings, timing, and next properties to review');
  }
  return lines.slice(0, 5);
}

function appendMeetingPrepSection(bodyText, profType, leadContext = {}) {
  const lines = buildMeetingPrepLines(profType, leadContext);
  if (!lines.length) return bodyText;
  const heading = meetingPrepHeading(leadContext);
  const checklist = `${heading}, please have the following ready:\n${lines.map((line) => `• ${line}`).join('\n')}`;
  return `${String(bodyText || '').trim()}\n\n${checklist}`.trim();
}

function meetingPrepHtml(bodyText, profType, leadContext = {}) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const main = String(bodyText || '').trim();
  const mainHtml = main
    ? `<p>${esc(main).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`
    : '';
  const heading = meetingPrepHeading(leadContext);
  const lines = buildMeetingPrepLines(profType, leadContext);
  const checklistHtml = [
    `<p><strong>${esc(heading)}, please have the following ready:</strong></p>`,
    ...lines.map((line) => `<p>• ${esc(line)}</p>`),
  ].join('');
  return `${mainHtml}${checklistHtml}`;
}

function buildFallbackDraft(leadContext) {
  const firstName = compactSubjectPart(leadContext?.contact?.first_name) || 'there';
  const profType = String(leadContext?.professional_type || PROFESSIONAL_TYPE.AGENT).toLowerCase();
  const location =
    compactSubjectPart(leadContext?.property?.location || leadContext?.property?.address) ||
    'your transaction';
  const intent = compactSubjectPart(leadContext?.intent_summary?.primary_intent || leadContext?.intent);
  const budget = compactSubjectPart(leadContext?.property?.budget);
  const timeline = compactSubjectPart(leadContext?.property?.timeline);
  const qualification = leadContext?.qualification || {};

  if (profType === PROFESSIONAL_TYPE.LAWYER) {
    const stage = compactSubjectPart(qualification.transaction_stage);
    const closing = compactSubjectPart(qualification.closing_timeline);
    const subject = compactSubjectPart(
      closing ? `Closing timeline: next steps for ${location}` : `Next steps for your transaction in ${location}`,
    );
    const contextParts = [`Following up regarding your transaction in ${location}`];
    if (stage) contextParts.push(`at the ${stage} stage`);
    if (closing) contextParts.push(`with a target closing window of ${closing}`);
    const body_text = appendMeetingPrepSection(
      [
        `Hi ${firstName},`,
        `${contextParts.join(' ')}.`,
        'I would like to confirm where things stand and outline the next steps on our side.',
        'Please reply with any updates to your closing date or outstanding documents, or let me know a convenient time to connect.',
      ].join('\n\n'),
      profType,
      leadContext,
    );
    return validateEmailDraft({
      subject,
      body_text,
      body_html: meetingPrepHtml(
        [
          `Hi ${firstName},`,
          `${contextParts.join(' ')}.`,
          'I would like to confirm where things stand and outline the next steps on our side.',
          'Please reply with any updates to your closing date or outstanding documents, or let me know a convenient time to connect.',
        ].join('\n\n'),
        profType,
        leadContext,
      ),
    });
  }

  if (profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    const preApproval = compactSubjectPart(qualification.pre_approval_status);
    const subject = compactSubjectPart(`Financing next steps for ${location}`);
    const contextParts = [`Following up on your financing plans for ${location}`];
    if (preApproval) contextParts.push(`with pre-approval status noted as ${preApproval}`);
    if (timeline) contextParts.push(`and your ${timeline} timeline`);
    const bodyCore = [
      `Hi ${firstName},`,
      `${contextParts.join(' ')}.`,
      'I would like to confirm what remains on the financing checklist and schedule the appropriate next review.',
      'Reply with any updates, or let me know a convenient time to connect.',
    ].join('\n\n');
    const body_text = appendMeetingPrepSection(bodyCore, profType, leadContext);
    return validateEmailDraft({
      subject,
      body_text,
      body_html: meetingPrepHtml(bodyCore, profType, leadContext),
    });
  }

  const subject = compactSubjectPart(
    intent && location !== 'your transaction'
      ? `${location}: next steps for your ${intent} plans`
      : `Next steps for ${location}`,
  );

  const contextParts = [`Following up on your search in ${location}`];
  if (budget) contextParts.push(`within the budget range you shared (${budget})`);
  if (timeline) contextParts.push(`on your ${timeline} timeline`);

  const bodyCore = [
    `Hi ${firstName},`,
    `${contextParts.join(' ')}.`,
    'I would like to confirm your current priorities and align the next properties we review.',
    'Reply with any updates to your criteria, or let me know a convenient time to connect.',
  ].join('\n\n');
  const body_text = appendMeetingPrepSection(bodyCore, profType, leadContext);

  return validateEmailDraft({
    subject,
    body_text,
    body_html: meetingPrepHtml(bodyCore, profType, leadContext),
  });
}

const SYSTEM_DRAFT = `You draft client follow-up emails on behalf of the licensed professional in lead_context.professional_type (agent, lawyer, or mortgage_broker). Write as that professional's office would — never as a generic chatbot.

GLOBAL VOICE:
- Polished, confident, and professional. Clear sentences; active voice; no slang or filler.
- Avoid hype ("exciting", "amazing"), empty praise ("great to hear"), and stock openers ("I hope this finds you well", "Touching base", "Circling back", "I wanted to reach out") unless explicitly requested in goal.
- Open with purpose after the greeting: reference their stated goal, timeline, or situation — not generic pleasantries.

DATA DISCIPLINE:
- Use only facts from lead_context (intent, location, property type, beds/baths, budget, qualification, timeline, ICP, conversation signals, must-haves).
- Weave 2–4 relevant facts into natural prose — never dump JSON or label lists.
- Financing/pre-approval: state once, factually — not celebratory.
- If calendly_booking_status is "booked", acknowledge briefly; do not push scheduling.
- Referral leads: acknowledge the referral in one natural clause; use referral_notes as directional guidance only — client-safe language.
- Never copy internal labels verbatim ("Strong buyer match", match_headline, etc.).
- No guaranteed outcomes; no invented facts, neighborhoods, or listing details.

ROLE-SPECIFIC STYLE (use professional_type, or referral_context.action_professional_role / target_professional_role when present):

AGENT (professional_type = agent):
- Executive brokerage tone: market-aware, action-oriented, focused on search fit and next showing steps.
- Reference search criteria (location, budget, beds/baths, must-haves) and readiness to view.
- If lead_context.intent is "sell" or property_matches_email.context is "sell": write as a seller follow-up. Do NOT say the seller has "search criteria", "matched listings", "property matches", "showings", or a property "within your budget". If property_matches_email.listings has items, write ONE concise transition sentence about reviewing buyer interest or market comparables below to support the sale strategy.
- If lead_context.intent is not "sell" and property_matches_email.listings has items: the send template appends a formatted HTML listings section. In body_text write ONE concise transition sentence directing them to review the matched listings below — no property listing bullets, no numbered listing lists (e.g. "1. Name - $700,000, 3 beds..."), no markdown tables (never use | pipe characters), and no property rows in the main message.
- Budget consistency when referencing matches in prose: distinguish "within budget" vs "above budget/stretch" clearly; never contradict.
- If listings is empty, do not mention or invent properties; for buyers focus on clarifying criteria and scheduling a search review, and for sellers focus on listing strategy, pricing expectations, and timing.
- CTA: for buyers, confirm priorities, schedule a showing, or reply with updated criteria. For sellers, confirm sale priorities, pricing expectations, timeline, and next listing strategy discussion.
- Meeting prep checklist themes (pick 3–5 only, tailored to lead_context): photo ID; financing pre-approval/pre-qual; updated must-haves and deal-breakers; preferred areas and budget; showing availability; for sellers — property details and ideal closing timeline.

REAL ESTATE LAWYER (professional_type = lawyer):
- Formal attorney-office tone: measured, reassuring, precise. This is legal correspondence — not a realtor sales email.
- Reference transaction stage, closing timeline, transaction type, and legal services needed from qualification.
- NEVER discuss property search, showings, listings, market options, or neighborhood recommendations. No listing language whatsoever.
- NEVER provide legal advice, interpret documents, or state legal conclusions — invite consultation for personalized guidance.
- CTA: confirm closing dates/documents, schedule a consultation, or reply with transaction updates.
- Meeting prep checklist themes (pick 3–5 only, tailored to lead_context): photo ID; agreement of purchase and sale; mortgage commitment/approval letter; title documents received; survey or status certificate questions; target closing date; outstanding questions about adjustments or title insurance.

MORTGAGE BROKER (professional_type = mortgage_broker):
- Professional financing tone: clarity on readiness, timelines, and next documentation steps — not property sales.
- Reference pre-approval status, mortgage timeline, purchase purpose, and budget from qualification.
- No property pitches, listing tables, or showing language; focus on financing progression.
- CTA: confirm documents/timeline or schedule a financing review.
- Meeting prep checklist themes (pick 3–5 only, tailored to lead_context): photo ID; pay stubs or employment letter; tax documents (T4/NOA); recent bank statements; down payment source; questions on rate hold, pre-approval amount, or remaining documentation.

MEETING PREPARATION SECTION (required for every draft):
- After the CTA paragraph, add a concise preparation block so the email feels like professional meeting coordination — not a generic marketing blast.
- Heading: use "Before our meeting" unless lead_context.conversation.calendly_booking_status is "booked", then use "To make the most of our scheduled meeting".
- Include 3–5 checklist items as short lines prefixed with "• " in body_text (one item per line).
- Mirror in body_html: one <p><strong>Heading:</strong></p> then one <p>• item</p> per checklist line.
- Customize items using lead_context only — skip items already confirmed, and never invent documents the client has not discussed.
- Do NOT mix property listing bullets into this checklist. Listing tables remain separate for agents only.

STRUCTURE:
- Subject: specific and professional (reflect role-appropriate topic); no clickbait; ~120 chars or less.
- Body order:
  1) "Hi {first_name}," or "Hi there,"
  2) One context sentence grounded in their situation
  3) One value/next-step paragraph with a decisive, role-appropriate CTA
  4) Meeting preparation heading + 3–5 tailored checklist items
- Keep the main message compact (2–4 short paragraphs before the checklist). No sign-off, name, phone, email, or scheduling URLs — the platform appends those.

Output one JSON object: subject, body_text, body_html (p, br, strong only — no <a>). Body well under 800 words.`;

const SYSTEM_REFINE = `You refine nurture emails to the same professional standard as draft generation. Mirror lead_context.professional_type (or referral_context.action_professional_role / target_professional_role).

Keep main message only — no scheduling links, no closings, no contact block. The platform appends scheduling and signature.

Refinement rules:
- AGENT: executive brokerage tone. For seller leads, remove buyer-search wording such as "matched listings", "property matches", "within your budget", and "showings"; reference buyer interest or market comparables only. For buyer leads, one transition sentence for listings if property_matches_email has items — no property listing bullets, no numbered listing lists, no markdown tables (never use | pipe characters), and no property rows in the main message.
- LAWYER: formal attorney-office tone; transaction/closing focus only — remove any property search, listing, or sales language.
- MORTGAGE BROKER: financing-focused tone — remove property pitch or listing language.
- Preserve or improve the meeting preparation checklist (3–5 role-appropriate items with • lines). Use "Before our meeting" or "To make the most of our scheduled meeting" based on calendly_booking_status.
- Break oversized paragraphs into short blocks.
- Remove stock openers, filler praise, and raw internal labels.
- No "Matched options include:", property listing bullet rows, numbered listing lists, or markdown tables (| pipes) in the main message.
- Enforce budget consistency language for agents when matches are referenced in prose.

Output only JSON: { "subject", "body_text", "body_html" } with p, br, strong only in body_html (no <a>).`;

async function completionToEmailDraft(system, userContent, temperature, logLabel) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await getOpenAI().chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      temperature: attempt === 0 ? temperature : 0,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            attempt === 0
              ? userContent
              : `${userContent}\n\nReturn only a valid JSON object with string keys subject, body_text, and body_html.`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content || '';
    try {
      return validateEmailDraft(extractJsonObject(raw));
    } catch (e) {
      lastErr = e;
      logger.warn(`${logLabel} JSON parse/validate failed`, { attempt: attempt + 1, error: e.message });
    }
  }
  throw new Error(lastErr?.message || 'AI returned invalid JSON');
}

export async function generateDraft(leadContext, { goal = null, tone = 'professional' } = {}) {
  const userPayload = JSON.stringify({
    lead_context: leadContext,
    goal:
      goal
      || 'Re-engage the lead, move toward a booked conversation, and include a role-appropriate meeting-preparation checklist.',
    tone,
  });
  try {
    return await completionToEmailDraft(SYSTEM_DRAFT, `Generate the email.\n${userPayload}`, 0.24, 'nurture draft');
  } catch (err) {
    logger.warn('nurture draft fallback used', { error: err.message });
    return buildFallbackDraft(leadContext);
  }
}

export async function refineDraft(leadContext, { subject, body_text }, instruction) {
  const userPayload = JSON.stringify({
    lead_context: leadContext,
    current_draft: { subject, body_text },
    user_instruction: instruction,
  });
  return completionToEmailDraft(
    SYSTEM_REFINE,
    `Apply the instruction and return the full updated email as JSON.\n${userPayload}`,
    0.3,
    'nurture refine',
  );
}
