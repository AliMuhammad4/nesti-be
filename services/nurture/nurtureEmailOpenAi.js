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
 * @param {{ property_matches?: { listings?: unknown[], context?: string | null, note?: string | null } }} [extras]
 */
export function buildLeadContext(leadMatch, profile, conversation, extras = {}) {
  const profType = profTypeFromLead(leadMatch);
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
  };
}

function extractJsonObject(raw) {
  const t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fence ? fence[1].trim() : t;
  return JSON.parse(jsonStr);
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

const SYSTEM_DRAFT = `You draft follow-up emails on behalf of licensed real estate professionals (agents, mortgage brokers, or real estate attorneys—mirror professional_type in lead_context).

Voice (executive, brokerage-grade):
- Sound like a seasoned advisor: clear, direct, warm but not chatty. Prefer active voice and short sentences.
- Avoid hype ("exciting", "amazing"), empty praise ("great to hear"), and filler ("just", "I wanted to reach out").
- Do NOT open with stock phrases: "I hope this message finds you well", "Hope you are well", "I hope you're doing well", "Touching base", "Circling back", "Following up on my last email"—unless the user goal explicitly asks for them. Prefer a purpose-led first line after the greeting (e.g. reference their search criteria or next step).

Use the data:
- Draw only from lead_context. Weave 2–5 relevant facts (intent, market/location, property type, beds/baths, budget or budget_numbers, qualification, timeline, ICP, conversation signals, must-haves) into prose—never dump the JSON as a list.
- Financing/pre-approval: state it once, factually (e.g. "With financing already in place…")—not celebratory.
- If calendly_booking_status is "booked", acknowledge briefly; do not push scheduling (the platform adds it).
- Respect professional_type: mortgage = financing readiness; lawyer = transaction stage without legal advice; agent = listings/search/showings.
- Property matches: when property_matches_email.listings has items, the send template may add formatted cards—do not paste long MLS-style blocks or repeat every field. You **must** still name **each listing's asking price** in body_text when the listing's price field is present in listing data (format clearly, e.g. $50,000), for up to the first 3 listings; one short clause per home (price + location or match_headline) is enough. When the lead has budget_numbers or property.budget, explicitly connect listing price to their range (e.g. "within your budget" or "just above/below your range—worth a look") using only provided numbers. For 4+ listings, give a tight summary plus price **range** across those listings if inferable, otherwise say prices are in the matched homes below. If listings is empty, do not invent properties.

Structure:
- Subject: specific, professional (market + intent), no clickbait.
- Body: "Hi {first_name}," or "Hi there," then 2–3 compact paragraphs (3–5 sentences total when possible). Close with one decisive CTA (e.g. which home to prioritize, what to send next, or a single scheduling-oriented question)—avoid vague "let me know" / "I'd love to hear from you" unless there is no alternative.
- Do NOT include: scheduling URLs, any sign-off, name, email, phone, or [Your Name]—the platform appends those.

Compliance:
- No guaranteed outcomes; no invented facts, neighborhoods, or listing details.

Output one JSON object: subject, body_text, body_html (p, br, strong only—no <a>). Subject ~120 chars or less; body well under 800 words.`;

const SYSTEM_REFINE = `You refine nurture emails to the same standard as draft generation: executive real-estate tone, crisp sentences, no stock openers or filler praise, only lead_context facts.

Keep main message only—no scheduling links, no closings, no contact block. The platform appends scheduling and signature.

Improve wording and flow; if property_matches_email has listings, keep prose compact but **retain or add each listing's asking price** when present (up to 3 homes), and any budget tie-in—cards on send are supplemental, not a substitute for price in the letter.

Output only JSON: { "subject", "body_text", "body_html" } with p, br, strong only in body_html (no <a>).`;

async function completionToEmailDraft(system, userContent, temperature, logLabel) {
  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    temperature,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });
  const raw = completion.choices[0]?.message?.content || '';
  try {
    return validateEmailDraft(extractJsonObject(raw));
  } catch (e) {
    logger.warn(`${logLabel} JSON parse/validate failed`, { error: e.message });
    throw new Error('AI returned invalid JSON');
  }
}

export async function generateDraft(leadContext, { goal = null, tone = 'professional' } = {}) {
  const userPayload = JSON.stringify({
    lead_context: leadContext,
    goal: goal || 'Re-engage the lead and move toward a booked conversation.',
    tone,
  });
  return completionToEmailDraft(SYSTEM_DRAFT, `Generate the email.\n${userPayload}`, 0.24, 'nurture draft');
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
