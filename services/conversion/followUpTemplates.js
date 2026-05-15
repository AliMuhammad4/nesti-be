import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return a human-readable first name or null. */
function firstName(ctx) {
  const full = String(ctx.full_name || ctx.contact_name || '').trim();
  if (!full) return null;
  return full.split(/\s+/)[0];
}

/** e.g. "morning" → "in the morning", "evening" → "in the evening" */
function timePhrase(bestTime) {
  if (!bestTime) return null;
  const t = String(bestTime).toLowerCase().trim();
  if (t === 'anytime') return null;
  return `in the ${t}`;
}

/** Return topic string based on prof / intent. */
function topicFor(prof, intent) {
  if (prof === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return 'your financing options';
  if (prof === PROFESSIONAL_TYPE.LAWYER) return 'your transaction';
  return String(intent || 'buy').toLowerCase() === 'sell' ? 'selling your home' : 'your home search';
}

/** Build a short lead context line: "your search in Lahore (budget 40k–60k, timeline: ASAP)" */
function contextLine(ctx) {
  const parts = [];
  const loc = ctx.location || ctx.area;
  if (loc) parts.push(`in ${loc}`);
  if (ctx.budget) parts.push(`budget ${ctx.budget}`);
  if (ctx.timeline && ctx.timeline !== 'flexible') parts.push(`timeline: ${ctx.timeline}`);
  return parts.length ? `(${parts.join(', ')})` : '';
}

// ─── Template builders ────────────────────────────────────────────────────────

function buildCallNowTemplate(ctx) {
  const { intent = 'buy', professional_type: prof = PROFESSIONAL_TYPE.AGENT } = ctx;
  const topic = topicFor(prof, intent);
  const name = firstName(ctx);
  const timing = timePhrase(ctx.best_time_to_contact);
  const nameGreet = name ? `, ${name}` : '';
  const timeSuffix = timing ? ` I usually have good availability ${timing}.` : '';
  return `Hi${nameGreet}, this is [your name] — I'm following up from your chat about ${topic}. I'll try again shortly; feel free to text or call me at [number].${timeSuffix}`;
}

function buildPersonalizedEmailTemplate(ctx) {
  const name = firstName(ctx);
  const topic = topicFor(ctx.professional_type, ctx.intent);
  const context = contextLine(ctx);
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  return `${nameGreet},\n\nThanks for reaching out about ${topic}${context ? ' ' + context : ''}. Based on what you shared, I've put together a few thoughts that might be helpful.\n\nI'd love to connect for a quick 15-minute call — would [day/time 1] or [day/time 2] work? If not, feel free to book directly at [your booking link].\n\nLooking forward to helping you find the right fit.\n\n[Your name]`;
}

function offerMeetingChatPhrase(ctx) {
  const prof = ctx.professional_type;
  if (prof === PROFESSIONAL_TYPE.LAWYER) return 'about your matter';
  if (prof === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return 'about your financing plans';
  return 'about your search';
}

function buildOfferMeetingSlotsTemplate(ctx) {
  const name = firstName(ctx);
  const context = contextLine(ctx);
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  const timing = timePhrase(ctx.best_time_to_contact);
  const timeLine = timing ? ` I know you're usually available ${timing} — I'll keep that in mind.` : '';
  const intro = context ? ` ${offerMeetingChatPhrase(ctx)} ${context}` : '';
  return `${nameGreet} — thanks for the chat${intro}. I'd love to connect for a quick call.\n\nWould any of these work for you?\n• [Day 1, time]\n• [Day 2, time]\n• [Day 3, time]\n\nOr grab a slot directly: [your booking link].${timeLine}`;
}

function buildSmsWithSlotsTemplate(ctx) {
  const name = firstName(ctx);
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  const prof = ctx.professional_type;
  const focus =
    prof === PROFESSIONAL_TYPE.LAWYER
      ? 'your real estate matter'
      : prof === PROFESSIONAL_TYPE.MORTGAGE_BROKER
        ? 'your mortgage timeline'
        : 'your home search';
  return `${nameGreet}! Following up on ${focus}. Happy to connect — available [Day] at [time] or [Day] at [time]. Book here: [link]`;
}

function buildConfirmAppointmentTemplate(ctx) {
  const name = firstName(ctx);
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  const timing = timePhrase(ctx.best_time_to_contact);
  const timeLine = timing ? ` As requested, I've scheduled us ${timing}.` : '';
  return `${nameGreet}, just confirming our upcoming call — you'll receive a calendar invite shortly.${timeLine} If anything changes, reply here and we'll reschedule. Looking forward to it!`;
}

function buildReengageTemplate(ctx) {
  const name = firstName(ctx);
  const topic = topicFor(ctx.professional_type, ctx.intent);
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  return `${nameGreet} — checking in after our last chat. Is ${topic} still on your radar? Happy to pick up where we left off whenever the timing is right.`;
}

function buildViewingReadinessTemplate(ctx) {
  const name = firstName(ctx);
  const loc = ctx.location || ctx.area;
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  const locLine = loc ? ` in ${loc}` : '';
  return `${nameGreet}, I wanted to check — are you available to view properties${locLine} this week? If so, I can line up a few options that match your criteria. What would make or break a viewing for you?`;
}

function buildPreapprovalPathTemplate(ctx) {
  const name = firstName(ctx);
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  return `${nameGreet}, to get you the most accurate options could you share where you are with your mortgage pre-approval — not started, in progress, or already approved? Also, what's your target purchase timeline?`;
}

function buildMatterScopeTemplate(ctx) {
  const name = firstName(ctx);
  const nameGreet = name ? `Hi ${name}` : 'Hi';
  return `${nameGreet}, to scope next steps: what stage is the transaction at, and are there any firm dates — financing, inspection, or closing — we should be working around?`;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const TEMPLATE_BUILDERS = {
  call_now:             buildCallNowTemplate,
  personalized_email:   buildPersonalizedEmailTemplate,
  offer_meeting_slots:  buildOfferMeetingSlotsTemplate,
  sms_with_slots:       buildSmsWithSlotsTemplate,
  confirm_appointment:  buildConfirmAppointmentTemplate,
  reengage:             buildReengageTemplate,
  viewing_readiness:    buildViewingReadinessTemplate,
  preapproval_path:     buildPreapprovalPathTemplate,
  matter_scope:         buildMatterScopeTemplate,
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function followUpTemplateForAction(actionId, ctx = {}) {
  const builder = TEMPLATE_BUILDERS[actionId];
  if (!builder) return null;
  return builder(ctx);
}
