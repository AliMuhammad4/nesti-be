import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
import { buildMatchStory } from './matchStory.js';
import { resolveNextActions } from './playbooks.js';
import { computeSpeedToLead, recommendedFirstResponseMinutes, outreachUrgency } from './speedToLead.js';

function mergedContact(leadMatch, leadProfile) {
  const fromMatch = leadMatch?.compatibility_factors?.contact;
  const fromProfile = leadProfile?.identity;
  const email = String(fromProfile?.email || fromMatch?.email || '').trim();
  const phone = String(fromProfile?.phone || fromMatch?.phone || '').trim();
  const fullName = String(fromProfile?.full_name || fromMatch?.full_name || fromProfile?.name || '').trim();
  const bestTime = fromProfile?.best_time_to_contact || fromMatch?.best_time_to_contact || null;
  const preferred =
    leadProfile?.contact_preferences?.preferred_contact_method ||
    fromMatch?.preferred_contact_method ||
    null;
  return {
    has_email: !!email,
    has_phone: !!phone,
    email: email || null,
    phone: phone || null,
    full_name: fullName || null,
    preferred_contact_method: preferred,
    best_time_to_contact: bestTime,
  };
}

function mergedProperty(leadMatch, leadProfile) {
  const fromProfile = leadProfile?.property_requirements || leadProfile?.property || {};
  const fromMatch = leadMatch?.compatibility_factors?.property || {};
  return {
    location: fromProfile.location || fromProfile.area || fromMatch.location || null,
    budget: fromProfile.budget || fromMatch.budget || null,
    timeline: fromProfile.timeline || fromMatch.timeline || null,
    area: fromProfile.location || fromProfile.area || fromMatch.location || null,
  };
}

function resolveIntent(leadProfile, conversation) {
  const i = leadProfile?.intent ?? conversation?.intent;
  if (i === 'buy' || i === 'sell') return i;
  return 'buy';
}

function resolveProfType(leadMatch, leadProfile) {
  return (
    leadMatch?.compatibility_factors?.professional_type ||
    leadProfile?.ownership?.professional_type ||
    PROFESSIONAL_TYPE.AGENT
  );
}

function buildAlerts(grade, appointmentStatus, speed) {
  const reasons = [];
  const g = String(grade || '').toLowerCase();
  const appt = appointmentStatus;
  let level = 'standard';
  let title = null;
  if (appt === 'booked') {
    if (g === 'hot' || g === 'warm') {
      reasons.push('High-intent lead with a booked meeting — confirm details and reduce no-shows.');
    } else {
      reasons.push('Meeting on the calendar — send a brief confirmation.');
    }
    level = g === 'hot' || g === 'warm' ? 'high' : 'standard';
    title =
      g === 'hot' || g === 'warm'
        ? 'Booked lead — confirm the meeting'
        : 'Meeting scheduled — follow up';
  } else {
    if (g === 'hot') reasons.push('Hot lead — prioritize human outreach.');
    if (g === 'warm' && appt === 'not_booked') {
      reasons.push('Warm lead with no booking yet — propose a concrete next step.');
    }
    if (speed.within_sla === false && appt === 'not_booked') {
      reasons.push('Visitor last active beyond your recommended first-response window.');
    }
    if (g === 'hot' && appt === 'not_booked') level = 'critical';
    else if (g === 'hot') level = 'high';
    else if (g === 'warm' && appt === 'not_booked' && speed.within_sla === false) level = 'high';
    else if (g === 'warm' && appt === 'not_booked') level = 'high';
    else if (speed.within_sla === false && appt === 'not_booked') level = 'high';
    title =
      level === 'critical'
        ? 'High-intent lead — respond now'
        : level === 'high'
          ? 'Timely follow-up recommended'
          : null;
  }
  return {
    should_notify: reasons.length > 0,
    level,
    title,
    reasons,
    surface_as_notification: level === 'critical' || level === 'high',
  };
}

function buildOutcomesFocus(grade, appointmentStatus, speed, intent) {
  const g = String(grade || '').toLowerCase();
  const appt = appointmentStatus;
  const i = String(intent || 'buy').toLowerCase();
  let primary_outcome = 'build_relationship';
  if (appt === 'booked') primary_outcome = 'deliver_scheduled_meeting';
  else if (appt === 'not_booked' && (g === 'hot' || g === 'warm')) primary_outcome = 'book_next_meeting';
  else if (speed.within_sla === false && appt === 'not_booked') primary_outcome = 'recover_speed_to_lead';
  const headline =
    primary_outcome === 'book_next_meeting'
      ? 'Primary goal: get a call or showing on the calendar — speed beats perfect notes.'
      : primary_outcome === 'recover_speed_to_lead'
        ? 'Primary goal: re-establish contact inside your SLA before the lead goes cold.'
        : primary_outcome === 'deliver_scheduled_meeting'
          ? 'Primary goal: confirm the booking and reduce no-shows.'
          : 'Primary goal: helpful touchpoints until timing is right.';
  const booking_cta =
    appt === 'not_booked' && (g === 'hot' || g === 'warm')
      ? i === 'sell'
        ? 'Offer a listing conversation or market walkthrough — anchor to a specific time.'
        : 'Offer two concrete slots for a call or showing, or share your booking link.'
      : appt === 'not_booked'
        ? 'When they reply, steer toward one short call before deep qualification.'
        : null;

  return {
    primary_outcome,
    headline,
    booking_cta,
    prioritize: ['response_speed', 'meeting_booked', 'visitor_re_engaged'],
  };
}

function buildLeadConversionCore({
  leadMatch,
  leadProfile = null,
  conversation = null,
  intent: intentOverride = null,
}) {
  const grade = String(leadMatch?.lead_type || '').split('_')[0] || 'warm';
  const profType = resolveProfType(leadMatch, leadProfile);
  const intent = intentOverride || resolveIntent(leadProfile, conversation);
  const contact = mergedContact(leadMatch, leadProfile);
  const property = mergedProperty(leadMatch, leadProfile);
  const appointmentStatus = resolveAppointmentStatus(
    leadMatch?.match_status,
    conversation?.calendly_booking_status,
  );
  const speed = computeSpeedToLead({ leadMatch, conversation });
  const next_actions = resolveNextActions({
    professional_type: profType,
    grade,
    appointment_status: appointmentStatus,
    intent,
    has_phone: contact.has_phone,
    has_email: contact.has_email,
    preferred_contact_method: contact.preferred_contact_method,
    minutes_since_visitor_activity: speed.minutes_since_visitor_activity,
    // Personalization context for follow-up templates
    full_name: contact.full_name,
    contact_name: contact.full_name,
    best_time_to_contact: contact.best_time_to_contact,
    location: property.location,
    area: property.area,
    budget: property.budget,
    timeline: property.timeline,
  });
  const match_story = buildMatchStory({ leadMatch, conversation, intent });
  const alerts = buildAlerts(grade, appointmentStatus, speed);
  const outcomes_focus = buildOutcomesFocus(grade, appointmentStatus, speed, intent);
  return { match_story, next_actions, speed, alerts, outcomes_focus };
}

function toConversionPack(core) {
  const { match_story, next_actions, speed, alerts, outcomes_focus } = core;
  const [primary, ...rest] = next_actions;
  const icp = match_story.icp_alignment;
  return {
    headline: match_story.headline,
    why_one_liner: match_story.why_strong_match?.one_liner ?? null,
    signals: Array.isArray(match_story.signal_bullets) ? match_story.signal_bullets.slice(0, 6) : [],
    icp_highlights: (() => {
      if (!icp) return null;
      const hl = (icp.strengths || []).slice(0, 3).map((s) => s.title);
      return hl.length ? hl : null;
    })(),
    primary_action: primary
      ? {
          id: primary.id,
          title: primary.title,
          channel: primary.channel,
          follow_up_template: primary.follow_up_template ?? null,
        }
      : null,
    secondary_actions: rest.slice(0, 2).map((a) => ({
      id: a.id,
      title: a.title,
      priority: a.priority,
    })),
    alert: {
      surface: !!alerts.surface_as_notification,
      level: alerts.level,
      title: alerts.title,
      reason: alerts.reasons?.[0] ?? null,
    },
    speed: {
      minutes_since_visitor_activity: speed.minutes_since_visitor_activity,
      within_sla: speed.within_sla,
      recommended_first_response_minutes: speed.recommended_first_response_minutes,
      urgency: speed.urgency,
      appointment_status: speed.booking_goal?.appointment_status ?? null,
    },
    outcome: {
      primary_outcome: outcomes_focus.primary_outcome,
      headline: outcomes_focus.headline,
      booking_cta: outcomes_focus.booking_cta ?? null,
    },
  };
}

export function buildLeadConversionPack({
  leadMatch,
  leadProfile = null,
  conversation = null,
  intent: intentOverride = null,
} = {}) {
  const core = buildLeadConversionCore({
    leadMatch,
    leadProfile,
    conversation,
    intent: intentOverride,
  });
  return toConversionPack(core);
}

export function buildConversionHintFromGrade({
  grade,
  intent,
  appointmentStatus,
  hasPhone,
  hasEmail,
  preferredContactMethod,
  professionalType,
}) {
  const g = String(grade || 'cold').toLowerCase();
  const appt = String(appointmentStatus || 'not_booked').toLowerCase();
  const slaMinutes = recommendedFirstResponseMinutes(g, appt);
  const urgency = outreachUrgency(g, appt, null);
  const fakeSpeed = { within_sla: null, minutes_since_visitor_activity: null };
  const alerts = buildAlerts(g, appt, fakeSpeed);
  const outcomes = buildOutcomesFocus(g, appt, fakeSpeed, intent || 'buy');
  const actions = resolveNextActions({
    professional_type: professionalType || PROFESSIONAL_TYPE.AGENT,
    grade: g,
    appointment_status: appt,
    intent: intent || 'buy',
    has_phone: !!hasPhone,
    has_email: !!hasEmail,
    preferred_contact_method: preferredContactMethod ?? null,
    minutes_since_visitor_activity: null,
  });
  const [primary, ...rest] = actions;
  return {
    grade: g,
    urgency,
    recommended_response_minutes: slaMinutes,
    alert: {
      level: alerts.level,
      title: alerts.title,
      reason: alerts.reasons?.[0] ?? null,
      surface: !!alerts.surface_as_notification,
    },
    primary_action: primary
      ? {
          id: primary.id,
          title: primary.title,
          channel: primary.channel,
          follow_up_template: primary.follow_up_template ?? null,
        }
      : null,
    secondary_actions: rest.slice(0, 2).map((a) => ({ id: a.id, title: a.title, priority: a.priority })),
    outcome_headline: outcomes.headline,
    booking_cta: outcomes.booking_cta ?? null,
  };
}

export function buildWorkspaceLeadConversionPreview({ leadMatch, conversation = null, intent = null }) {
  const pack = buildLeadConversionPack({
    leadMatch,
    leadProfile: null,
    conversation,
    intent,
  });
  const primary = pack.primary_action;
  return {
    headline: pack.headline,
    why_match_one_liner: pack.why_one_liner ?? null,
    outcomes_headline: pack.outcome?.headline ?? null,
    booking_cta: pack.outcome?.booking_cta ?? null,
    minutes_since_visitor_activity: pack.speed?.minutes_since_visitor_activity ?? null,
    recommended_response_within_minutes: pack.speed?.recommended_first_response_minutes ?? null,
    sla_at_risk: pack.speed?.within_sla === false,
    alert: {
      surface: !!pack.alert?.surface,
      level: pack.alert?.level ?? null,
      title: pack.alert?.title ?? null,
      reasons: pack.alert?.reason ? [pack.alert.reason] : [],
    },
    primary_next_action_id: primary?.id ?? null,
    primary_next_action_title: primary?.title ?? null,
    primary_follow_up_template: primary?.follow_up_template ?? null,
    urgency: pack.speed?.urgency ?? null,
  };
}
