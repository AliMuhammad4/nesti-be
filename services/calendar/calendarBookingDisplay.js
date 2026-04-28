/** Shared shape for `/api/calendar/bookings` rows (collection + legacy paths). */

export function parseValidDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function firstValidDate(...values) {
  for (const v of values) {
    const d = parseValidDate(v);
    if (d) return d;
  }
  return null;
}

export function sortBookingsByStartDesc(bookings) {
  bookings.sort((a, b) => {
    const ta = a.starts_at ? new Date(a.starts_at).getTime() : 0;
    const tb = b.starts_at ? new Date(b.starts_at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return String(b.lead_match_id || '').localeCompare(String(a.lead_match_id || ''));
  });
  return bookings;
}

function intentFromProfileAndConv(profile, conv) {
  if (profile?.intent != null && String(profile.intent).trim()) {
    return String(profile.intent).trim();
  }
  if (conv?.intent != null && String(conv.intent).trim()) {
    return String(conv.intent).trim();
  }
  return null;
}

function propertyTypeFromProfile(profile) {
  const pt = profile?.property?.property_type;
  if (pt != null && String(pt).trim()) return String(pt).trim();
  return null;
}

function professionalTypeFromProfile(profile) {
  const pt = profile?.ownership?.professional_type;
  if (pt != null && String(pt).trim()) return String(pt).trim();
  return null;
}

function qualificationFromProfile(profile) {
  const q = profile?.qualification || {};
  return {
    agent: q.agent || {},
    mortgage_broker: q.mortgage_broker || {},
    lawyer: q.lawyer || {},
  };
}

function contactFromProfile(profile, inviteeEmailFallback) {
  const identity = profile?.identity || {};
  return {
    full_name: identity.full_name || null,
    email:
      identity.email ||
      identity.canonical_email ||
      (inviteeEmailFallback ? String(inviteeEmailFallback) : null),
  };
}

function appointmentTitle(matchStatus, bookedViaNurture) {
  if (matchStatus === 'showing_booked') return 'Showing booked';
  if (matchStatus === 'consult_booked') return 'Consultation booked';
  if (bookedViaNurture) return 'Consultation booked';
  return 'Appointment booked';
}

/**
 * Build one API booking row from lead/profile/conv + optional WorkspaceAppointment lean doc.
 */
export function buildCalendarBookingRow({
  leadMatchId,
  conversationId,
  matchStatus,
  startsAt,
  profile,
  conv,
  calFromLead,
  inviteeEmailFallback = null,
  workspaceAppointment = null,
}) {
  const bookedViaNurture = Boolean(workspaceAppointment?.booked_via_nurture);
  const cancelableViaCalendly = Boolean(
    workspaceAppointment?.calendly_event_uri ||
      workspaceAppointment?.calendly_invitee_uri ||
      calFromLead?.calendly_event_uri ||
      calFromLead?.calendly_invitee_uri,
  );

  const row = {
    lead_match_id: leadMatchId != null && String(leadMatchId).trim() ? String(leadMatchId) : null,
    conversation_id: conversationId ? String(conversationId) : null,
    starts_at: startsAt ? startsAt.toISOString() : null,
    title: appointmentTitle(matchStatus, bookedViaNurture),
    match_status: matchStatus,
    cancelable_via_calendly: cancelableViaCalendly,
    contact: contactFromProfile(profile, inviteeEmailFallback),
    professional_type: professionalTypeFromProfile(profile),
    property_type: propertyTypeFromProfile(profile),
    intent: intentFromProfileAndConv(profile, conv),
    qualification: qualificationFromProfile(profile),
  };

  if (workspaceAppointment?._id) {
    row.workspace_appointment_id = String(workspaceAppointment._id);
  }
  if (bookedViaNurture) {
    row.booked_via_nurture = true;
  }

  return row;
}
