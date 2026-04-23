import mongoose from 'mongoose';
import NurtureLog from '../../models/NurtureLog.js';
import logger from '../../utils/logger.js';

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildNurtureLogMatchOr({ leadMatchId, conversationId, inviteeEmail, leadProfileId }) {
  const or = [];
  if (leadMatchId && mongoose.Types.ObjectId.isValid(String(leadMatchId))) {
    or.push({ lead_match_id: new mongoose.Types.ObjectId(String(leadMatchId)) });
  }
  if (conversationId && mongoose.Types.ObjectId.isValid(String(conversationId))) {
    or.push({ conversation_id: new mongoose.Types.ObjectId(String(conversationId)) });
  }
  const em = inviteeEmail && String(inviteeEmail).trim().toLowerCase();
  if (em) {
    or.push({ to_email: new RegExp(`^${escapeRegex(em)}$`, 'i') });
  }
  if (leadProfileId && mongoose.Types.ObjectId.isValid(String(leadProfileId))) {
    or.push({ lead_profile_id: new mongoose.Types.ObjectId(String(leadProfileId)) });
  }
  return or.length ? { $or: or } : null;
}

export async function markRecentNurtureLogBooked({
  userId,
  leadMatchId,
  leadProfileId,
  conversationId,
  inviteeEmail,
  calendlyScheduledStartIso,
}) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return { updated: false };
  const orBlock = buildNurtureLogMatchOr({
    leadMatchId,
    conversationId,
    inviteeEmail,
    leadProfileId,
  });
  if (!orBlock) return { updated: false };
  const filter = {
    user_id: new mongoose.Types.ObjectId(String(userId)),
    status: 'sent',
    meeting_booked: { $ne: true },
    ...orBlock,
  };
  const doc = await NurtureLog.findOne(filter).sort({ sent_at: -1, createdAt: -1 }).select('_id').lean();
  if (!doc?._id) return { updated: false };
  const now = new Date();
  const setFields = {
    meeting_booked: true,
    meeting_booked_at: now,
  };
  if (leadProfileId && mongoose.Types.ObjectId.isValid(String(leadProfileId))) {
    setFields.lead_profile_id = new mongoose.Types.ObjectId(String(leadProfileId));
  }
  if (calendlyScheduledStartIso != null && String(calendlyScheduledStartIso).trim() !== '') {
    const d = new Date(String(calendlyScheduledStartIso));
    if (!Number.isNaN(d.getTime())) setFields.calendly_scheduled_start = d;
  }
  await NurtureLog.updateOne({ _id: doc._id }, { $set: setFields });
  logger.info('NurtureLog: marked meeting booked from Calendly', {
    op: 'nurture.meeting_booked',
    nurture_log_id: String(doc._id),
  });
  return { updated: true, nurture_log_id: String(doc._id) };
}

export async function clearRecentNurtureLogMeetingBooked({
  userId,
  leadMatchId,
  leadProfileId,
  conversationId,
  inviteeEmail,
}) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return { updated: false };
  const orBlock = buildNurtureLogMatchOr({
    leadMatchId,
    conversationId,
    inviteeEmail,
    leadProfileId,
  });
  if (!orBlock) return { updated: false };
  const filter = {
    user_id: new mongoose.Types.ObjectId(String(userId)),
    meeting_booked: true,
    ...orBlock,
  };
  const doc = await NurtureLog.findOne(filter)
    .sort({ meeting_booked_at: -1, sent_at: -1 })
    .select('_id')
    .lean();
  if (!doc?._id) return { updated: false };
  await NurtureLog.updateOne(
    { _id: doc._id },
    {
      $set: { meeting_booked: false, meeting_booked_at: null },
      $unset: { calendly_scheduled_start: 1 },
    },
  );
  logger.info('NurtureLog: cleared meeting booked after Calendly cancel', {
    op: 'nurture.meeting_booked',
    nurture_log_id: String(doc._id),
  });
  return { updated: true, nurture_log_id: String(doc._id) };
}
