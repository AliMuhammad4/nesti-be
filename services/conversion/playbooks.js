import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { followUpTemplateForAction } from './followUpTemplates.js';

/** Resolve the best outreach channel given contact availability and preference. */
function resolveChannel(preferred, has_phone, has_email, fallback = 'in_app') {
  if (preferred === 'phone' && has_phone) return 'phone';
  if (preferred === 'email' && has_email) return 'email';
  if (preferred === 'sms' && has_phone) return 'sms';
  if (has_phone) return 'phone';
  if (has_email) return 'email';
  return fallback;
}

/** True when preferred contact method is email and we have the email. */
function prefersEmail(preferred, has_email) {
  return preferred === 'email' && has_email;
}

export function resolveNextActions(ctx) {
  const {
    professional_type: prof = PROFESSIONAL_TYPE.AGENT,
    grade = 'warm',
    appointment_status = 'not_booked',
    intent = 'buy',
    has_phone = false,
    has_email = false,
    preferred_contact_method = null,
    minutes_since_visitor_activity = null,
  } = ctx;

  const actions = [];
  const g = String(grade).toLowerCase();
  const appt = String(appointment_status).toLowerCase();
  const pref = String(preferred_contact_method || '').toLowerCase();

  // ── Appointment booked ────────────────────────────────────────────────────
  if (appt === 'booked') {
    const confirmChannel = pref === 'email' && has_email ? 'email' : pref === 'phone' && has_phone ? 'phone' : has_email ? 'email' : 'in_app';
    actions.push({
      id: 'confirm_appointment',
      priority: 'high',
      title: 'Confirm meeting details',
      detail: 'Restate date/time, how you will connect, and what they should prepare.',
      channel: confirmChannel,
    });
  }

  // ── Hot / warm — not yet booked ───────────────────────────────────────────
  if (appt === 'not_booked' && (g === 'hot' || g === 'warm')) {
    // If they prefer email, lead with email; otherwise lead with call/slots
    if (prefersEmail(pref, has_email)) {
      actions.push({
        id: 'personalized_email',
        priority: g === 'hot' ? 'critical' : 'high',
        title: 'Send a personalized email with 2–3 meeting slots',
        detail: 'Lead prefers email — include specific time options and your booking link.',
        channel: 'email',
      });
      if (has_phone) {
        actions.push({
          id: 'call_now',
          priority: g === 'hot' ? 'high' : 'normal',
          title: 'Follow up by phone if no reply within SLA',
          detail: 'Phone fallback after email — respects preference while maintaining speed.',
          channel: 'phone',
        });
      }
    } else if (pref === 'sms' && has_phone) {
      actions.push({
        id: 'sms_with_slots',
        priority: g === 'hot' ? 'critical' : 'high',
        title: 'Send a concise SMS with booking link',
        detail: 'Lead prefers text — keep it under 160 chars with one clear CTA.',
        channel: 'sms',
      });
      actions.push({
        id: 'offer_meeting_slots',
        priority: g === 'hot' ? 'high' : 'normal',
        title: 'Offer 2–3 specific times to talk',
        detail: 'Follow up with day/time options via their preferred SMS channel.',
        channel: 'sms',
      });
    } else {
      // Phone / no preference — standard hot-lead flow
      if (g === 'hot' && has_phone) {
        actions.push({
          id: 'call_now',
          priority: 'critical',
          title: 'Call now — within your SLA window',
          detail: 'Hot lead with phone on file — first human voice wins the appointment.',
          channel: 'phone',
        });
      }
      actions.push({
        id: 'offer_meeting_slots',
        priority: g === 'hot' ? 'critical' : 'high',
        title: 'Send 2–3 concrete time slots',
        detail: 'Day/time options plus your booking link — reply barrier is lowest this way.',
        channel: resolveChannel(pref, has_phone, has_email),
      });
      if (has_email) {
        actions.push({
          id: 'personalized_email',
          priority: g === 'hot' ? 'high' : 'normal',
          title: 'Send a short personalized email',
          detail: 'Reference their budget, location, and timeline — one clear CTA.',
          channel: 'email',
        });
      }
    }
  }

  // ── Cold / no appointment ─────────────────────────────────────────────────
  if (g === 'cold' && appt === 'not_booked' && has_email) {
    actions.push({
      id: 'personalized_email',
      priority: 'normal',
      title: 'Warm outreach email',
      detail: 'Low-pressure touchpoint — ask one qualifying question and leave the door open.',
      channel: 'email',
    });
  }

  // ── Re-engagement (gone quiet) ────────────────────────────────────────────
  if (
    minutes_since_visitor_activity != null &&
    minutes_since_visitor_activity > 24 * 60 &&
    appt === 'not_booked'
  ) {
    actions.push({
      id: 'reengage',
      priority: 'normal',
      title: 'Light re-engagement touch',
      detail: 'One helpful check-in — avoid hard selling if they have gone quiet.',
      channel: pref === 'email' && has_email ? 'email' : has_phone ? 'sms' : 'email',
    });
  }

  // ── Professional-type specific ────────────────────────────────────────────
  if (prof === PROFESSIONAL_TYPE.MORTGAGE_BROKER && intent !== 'sell') {
    actions.push({
      id: 'preapproval_path',
      priority: 'normal',
      title: 'Confirm financing stage',
      detail: 'Ask for pre-approval status (none / in-progress / approved) and purchase timeline.',
      channel: resolveChannel(pref, has_phone, has_email),
    });
  }
  if (prof === PROFESSIONAL_TYPE.LAWYER) {
    actions.push({
      id: 'matter_scope',
      priority: 'normal',
      title: 'Confirm matter scope and key dates',
      detail: 'Align on transaction stage, other parties, and any urgent closing dates.',
      channel: resolveChannel(pref, has_phone, has_email),
    });
  }
  if (prof === PROFESSIONAL_TYPE.AGENT && String(intent).toLowerCase() === 'buy') {
    actions.push({
      id: 'viewing_readiness',
      priority: appt === 'booked' ? 'high' : 'normal',
      title: 'Confirm viewing readiness',
      detail:
        appt === 'booked'
          ? 'Before your call, align on listings to tour and any blockers to an offer.'
          : 'Ask which areas and price range to prioritise and what would block an offer.',
      channel: 'in_app',
    });
  }

  const ordered = sortActionsByAppointmentAndGrade(dedupeById(actions), appt, g, pref);
  return attachFollowUpTemplates(ordered.slice(0, 6), ctx);
}
function sortActionsByAppointmentAndGrade(actions, appt, grade, pref = '') {
  const rank = (id) => {
    if (appt === 'booked') {
      const order = [
        'confirm_appointment',
        'personalized_email',
        'viewing_readiness',
        'preapproval_path',
        'matter_scope',
        'reengage',
      ];
      const i = order.indexOf(id);
      return i === -1 ? 20 : i;
    }
    if (appt === 'not_booked') {
      if (grade === 'hot') {
        // If they prefer email, email-first ordering
        const order = pref === 'email'
          ? ['personalized_email', 'call_now', 'offer_meeting_slots', 'sms_with_slots', 'viewing_readiness', 'preapproval_path', 'matter_scope', 'reengage']
          : pref === 'sms'
            ? ['sms_with_slots', 'offer_meeting_slots', 'call_now', 'personalized_email', 'viewing_readiness', 'preapproval_path', 'matter_scope', 'reengage']
            : ['call_now', 'offer_meeting_slots', 'personalized_email', 'sms_with_slots', 'viewing_readiness', 'preapproval_path', 'matter_scope', 'reengage'];
        const i = order.indexOf(id);
        return i === -1 ? 20 : i;
      }
      if (grade === 'warm') {
        const order = pref === 'email'
          ? ['personalized_email', 'offer_meeting_slots', 'call_now', 'sms_with_slots', 'viewing_readiness', 'preapproval_path', 'matter_scope', 'reengage']
          : pref === 'sms'
            ? ['sms_with_slots', 'offer_meeting_slots', 'personalized_email', 'call_now', 'viewing_readiness', 'preapproval_path', 'matter_scope', 'reengage']
            : ['offer_meeting_slots', 'call_now', 'personalized_email', 'sms_with_slots', 'viewing_readiness', 'preapproval_path', 'matter_scope', 'reengage'];
        const i = order.indexOf(id);
        return i === -1 ? 20 : i;
      }
      const order = [
        'personalized_email',
        'viewing_readiness',
        'preapproval_path',
        'matter_scope',
        'reengage',
        'offer_meeting_slots',
        'sms_with_slots',
        'call_now',
      ];
      const i = order.indexOf(id);
      return i === -1 ? 20 : i;
    }
    const order = [
      'offer_meeting_slots',
      'sms_with_slots',
      'call_now',
      'personalized_email',
      'confirm_appointment',
      'viewing_readiness',
      'preapproval_path',
      'matter_scope',
      'reengage',
    ];
    const i = order.indexOf(id);
    return i === -1 ? 20 : i;
  };

  const priorityRank = { critical: 0, high: 1, normal: 2 };
  return [...actions].sort((a, b) => {
    const dr = rank(a.id) - rank(b.id);
    if (dr !== 0) return dr;
    return (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
  });
}

function attachFollowUpTemplates(actions, ctx) {
  return actions.map((a) => {
    const follow_up_template = followUpTemplateForAction(a.id, ctx);
    return follow_up_template ? { ...a, follow_up_template } : { ...a };
  });
}

function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    if (!a?.id || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}
