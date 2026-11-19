import ChatConversation from '../../../models/ChatConversation.js';
import { buildWorkspaceLeadConversionPreview } from '../../conversion/buildLeadConversionPack.js';
import { emitLeadLifecycleNotification } from '../../realtime/leadCreatedNotify.js';
import { urgencyWindowLabel, severityFromConversionPreview, primaryNextActionFromPreview } from '../../lead/leadExperienceContract.js';
import { extractScheduledEventStartDate } from '../calendlyPayloadUtils.js';

function buildNotificationBase(lead, conversationId, preview) {
  return {
    lead_match_id:     lead._id,
    lead_profile_id:   lead.lead_profile_id || null,
    conversation_id:   conversationId || null,
    session_id:        lead.compatibility_factors?.session_id || null,
    grade:             String(lead.lead_type || '').split('_')[0] || null,
    score:             lead.match_score ?? null,
    urgency:           preview?.urgency ?? null,
    urgency_window:    urgencyWindowLabel(preview),
    outcomes_headline: preview?.outcomes_headline ?? null,
    action:            { type: 'open_lead', lead_match_id: String(lead._id) },
  };
}

async function fetchConvForPreview(conversationId) {
  if (!conversationId) return null;
  return ChatConversation.findById(conversationId)
    .select('calendly_booking_status lead_reasons last_interaction_at intent')
    .lean();
}

export async function emitBookingNotification(lead, conversationId, bookedViaNurture) {
  if (!lead?.user_id || !lead?._id) return;
  const conv = await fetchConvForPreview(conversationId);
  const preview = buildWorkspaceLeadConversionPreview({ leadMatch: lead, conversation: conv, intent: conv?.intent || null });
  await emitLeadLifecycleNotification(lead.user_id, {
    ...buildNotificationBase(lead, conversationId, preview),
    notification_type:  'appointment_booked',
    title:              bookedViaNurture ? 'Consultation booked via nurture email' : 'Appointment booked',
    body:               bookedViaNurture
      ? `Your nurture email converted — ${preview.why_match_one_liner || 'lead booked a consultation.'}`
      : preview.why_match_one_liner || 'Lead booked an appointment.',
    severity:           severityFromConversionPreview(preview?.alert ? { alert: preview.alert } : null),
    intent:             conv?.intent || null,
    appointment_status: 'booked',
    booked_via_nurture: bookedViaNurture,
    speed_to_lead_tip:  preview?.urgency === 'immediate' ? 'Confirm appointment details now to reduce no-shows.' : null,
    booking_cta:        preview?.booking_cta ?? null,
    primary_next_action: primaryNextActionFromPreview(preview),
  });
}

export async function emitOwnerBookingNotification({ userId, email, payload }) {
  if (!userId) return;
  const inviteeName =
    payload?.name ||
    payload?.invitee?.name ||
    [payload?.first_name, payload?.last_name].filter(Boolean).join(' ').trim() ||
    'A visitor';
  const startDate = extractScheduledEventStartDate(payload);
  await emitLeadLifecycleNotification(userId, {
    notification_type: 'consultation_booked',
    title: 'Consultation booked from public profile',
    body: `${inviteeName}${email ? ` (${email})` : ''} booked a consultation${startDate ? ` for ${startDate.toLocaleString()}` : ''}.`,
    severity: 'info',
    appointment_status: 'booked',
    action: {
      type: 'open_calendar',
      calendly_event_uri: typeof payload?.event === 'string' ? payload.event : payload?.event?.uri || null,
      calendly_invitee_uri: payload?.uri || null,
    },
  });
}

export async function emitCancelNotification(lead, conversationId) {
  if (!lead?.user_id || !lead?._id) return;
  const conv = await fetchConvForPreview(conversationId);
  const preview = buildWorkspaceLeadConversionPreview({ leadMatch: lead, conversation: conv, intent: conv?.intent || null });
  await emitLeadLifecycleNotification(lead.user_id, {
    ...buildNotificationBase(lead, conversationId, preview),
    notification_type:  'appointment_canceled',
    title:              'Appointment canceled',
    body:               'Booked appointment was canceled. Re-engage quickly to recover this opportunity.',
    severity:           'high',
    intent:             conv?.intent || null,
    appointment_status: 'canceled',
    urgency:            'same_day',
    urgency_window:     '24 hr',
    speed_to_lead_tip:  'Follow up within the same day to recover booking momentum.',
    booking_cta:        'Offer 2-3 new time slots now.',
    primary_next_action: {
      id:                  'offer_meeting_slots',
      title:               'Offer 2-3 specific times to rebook',
      follow_up_template:  preview?.primary_follow_up_template ?? null,
    },
  });
}
