import mongoose from 'mongoose';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import logger from '../../utils/logger.js';

function toOid(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
}

function toValidDate(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trimStr(v) {
  return v != null && String(v).trim() ? String(v).trim() : null;
}

/**
 * Upsert a booked appointment from Calendly. Idempotent on `calendly_invitee_uri`.
 */
export async function upsertBookedAppointmentFromCalendly({
  userId,
  leadMatchId,
  leadProfileId,
  conversationId,
  payloadCalendlyMeta,
  bookedViaNurture,
  nurtureLogId,
  inviteeEmail,
  scheduledStart,
  bookingOrigin,
}) {
  const uid = toOid(userId);
  if (!uid) return { ok: false, reason: 'invalid_user' };

  const inviteeUri = trimStr(payloadCalendlyMeta?.calendly_invitee_uri);
  const eventUri = trimStr(payloadCalendlyMeta?.calendly_event_uri);
  const isPublicProfileConsultation = trimStr(bookingOrigin) === 'public_profile_consultation';

  const setDoc = {
    user_id: uid,
    lead_match_id: isPublicProfileConsultation ? null : toOid(leadMatchId),
    lead_profile_id: isPublicProfileConsultation ? null : toOid(leadProfileId),
    conversation_id: isPublicProfileConsultation ? null : toOid(conversationId),
    status: 'booked',
    source: 'calendly',
    booking_origin: trimStr(bookingOrigin),
    booked_via_nurture: Boolean(bookedViaNurture),
    invitee_email: inviteeEmail ? String(inviteeEmail).trim().toLowerCase() || null : null,
    scheduled_start: toValidDate(scheduledStart),
    recorded_at: new Date(),
    canceled_at: null,
    calendly_event_uri: eventUri,
    nurture_log_id: toOid(nurtureLogId),
  };
  if (inviteeUri) setDoc.calendly_invitee_uri = inviteeUri;

  try {
    if (inviteeUri) {
      const doc = await WorkspaceAppointment.findOneAndUpdate(
        { calendly_invitee_uri: inviteeUri },
        { $set: setDoc },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ).lean();
      logger.info('WorkspaceAppointment: upsert booked', {
        op: 'workspace_appointment.upsert',
        id: String(doc._id),
      });
      return { ok: true, appointment_id: String(doc._id) };
    }

    const lm = toOid(leadMatchId);
    if (lm) {
      const existing = await WorkspaceAppointment.findOne({
        user_id: uid,
        lead_match_id: lm,
        status: 'booked',
        calendly_invitee_uri: null,
      })
        .sort({ recorded_at: -1 })
        .select('_id')
        .lean();

      if (existing) {
        await WorkspaceAppointment.updateOne({ _id: existing._id }, { $set: setDoc });
        return { ok: true, appointment_id: String(existing._id) };
      }
    }

    const created = await WorkspaceAppointment.create({ ...setDoc, calendly_invitee_uri: null });
    logger.info('WorkspaceAppointment: created booked', {
      op: 'workspace_appointment.create',
      id: String(created._id),
    });
    return { ok: true, appointment_id: String(created._id) };
  } catch (e) {
    logger.error(`WorkspaceAppointment upsert: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

/**
 * Mark the matching booked appointment as canceled.
 */
export async function markWorkspaceAppointmentCanceled({
  userId,
  inviteeUri,
  leadMatchId,
  conversationId,
  inviteeEmail,
}) {
  const uid = toOid(userId);
  if (!uid) return { ok: false, updated: false };

  const uri = trimStr(inviteeUri);
  let filter;

  if (uri) {
    filter = { calendly_invitee_uri: uri, user_id: uid, status: 'booked' };
  } else {
    const or = [];
    const lm = toOid(leadMatchId);
    if (lm) or.push({ lead_match_id: lm });
    const cid = toOid(conversationId);
    if (cid) or.push({ conversation_id: cid });
    const em = inviteeEmail ? String(inviteeEmail).trim().toLowerCase() : null;
    if (em) or.push({ invitee_email: em });
    if (!or.length) return { ok: true, updated: false };
    filter = { user_id: uid, status: 'booked', $or: or };
  }

  const doc = await WorkspaceAppointment.findOne(filter).sort({ recorded_at: -1 }).select('_id').lean();
  if (!doc) return { ok: true, updated: false };

  await WorkspaceAppointment.updateOne(
    { _id: doc._id },
    { $set: { status: 'canceled', canceled_at: new Date() } },
  );
  logger.info('WorkspaceAppointment: canceled', {
    op: 'workspace_appointment.cancel',
    id: String(doc._id),
  });
  return { ok: true, updated: true, appointment_id: String(doc._id) };
}
