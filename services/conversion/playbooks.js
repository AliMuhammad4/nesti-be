import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { followUpTemplateForAction } from './followUpTemplates.js';
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
  if (appt === 'not_booked' && (g === 'hot' || g === 'warm')) {
    actions.push({
      id: 'offer_meeting_slots',
      priority: g === 'hot' ? 'critical' : 'high',
      title: 'Offer 2–3 specific times to talk',
      detail: 'Short message with day/time options or your booking link increases conversion.',
      channel: 'in_app',
    });
  }
  if (appt === 'booked') {
    actions.push({
      id: 'confirm_appointment',
      priority: 'high',
      title: 'Send a brief confirmation',
      detail: 'Restate time zone, what to prepare, and how you will reach them.',
      channel: has_email ? 'email' : 'in_app',
    });
  }
  if (g === 'hot' && has_phone && appt === 'not_booked') {
    actions.push({
      id: 'call_now',
      priority: 'critical',
      title: 'Call within your SLA window',
      detail: 'Speed-to-lead matters most for hot leads; a quick human touch wins.',
      channel: 'phone',
    });
  }
  if (has_email && (!has_phone || preferred_contact_method === 'email')) {
    actions.push({
      id: 'personalized_email',
      priority:
        appt === 'booked' ? 'normal' : g === 'cold' ? 'normal' : 'high',
      title: 'Send a short personalized email',
      detail:
        appt === 'booked'
          ? 'Reinforce the scheduled time, what to bring, and how to reach you.'
          : 'Reference what they shared in chat and one clear next step.',
      channel: 'email',
    });
  }

  if (
    minutes_since_visitor_activity != null &&
    minutes_since_visitor_activity > 24 * 60 &&
    appt === 'not_booked'
  ) {
    actions.push({
      id: 'reengage',
      priority: 'normal',
      title: 'Light re-engagement',
      detail: 'One helpful check-in; avoid hard selling if they have gone quiet.',
      channel: has_email ? 'email' : 'sms',
    });
  }
  if (prof === PROFESSIONAL_TYPE.MORTGAGE_BROKER && intent !== 'sell') {
    actions.push({
      id: 'preapproval_path',
      priority: 'normal',
      title: 'Clarify pre-approval status',
      detail: 'Ask for stage (none / in progress / approved) and target purchase timeline.',
      channel: 'in_app',
    });
  }
  if (prof === PROFESSIONAL_TYPE.LAWYER) {
    actions.push({
      id: 'matter_scope',
      priority: 'normal',
      title: 'Confirm matter scope and closing pressure',
      detail: 'Align on transaction stage, other parties, and any urgent dates.',
      channel: 'in_app',
    });
  }
  if (prof === PROFESSIONAL_TYPE.AGENT && String(intent).toLowerCase() === 'buy') {
    actions.push({
      id: 'viewing_readiness',
      priority: appt === 'booked' ? 'high' : 'normal',
      title: 'Lock viewing readiness',
      detail:
        appt === 'booked'
          ? 'Before or after your call, align on listings to tour and any blockers to an offer.'
          : 'Ask if they are touring this week and what would block an offer.',
      channel: 'in_app',
    });
  }
  const ordered = sortActionsByAppointmentAndGrade(dedupeById(actions), appt, g);
  return attachFollowUpTemplates(ordered.slice(0, 6), ctx);
}
function sortActionsByAppointmentAndGrade(actions, appt, grade) {
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
        const order = [
          'call_now',
          'offer_meeting_slots',
          'personalized_email',
          'viewing_readiness',
          'preapproval_path',
          'matter_scope',
          'reengage',
        ];
        const i = order.indexOf(id);
        return i === -1 ? 20 : i;
      }
      if (grade === 'warm') {
        const order = [
          'offer_meeting_slots',
          'call_now',
          'personalized_email',
          'viewing_readiness',
          'preapproval_path',
          'matter_scope',
          'reengage',
        ];
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
        'call_now',
      ];
      const i = order.indexOf(id);
      return i === -1 ? 20 : i;
    }
    const order = [
      'offer_meeting_slots',
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
