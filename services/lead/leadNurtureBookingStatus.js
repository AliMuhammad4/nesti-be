import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import NurtureLog from '../../models/NurtureLog.js';

export async function buildNurtureConsultationBookedFromEmailByProfileIds(userObjectId, profileIds) {
  const map = new Map();
  const ids = (profileIds || [])
    .map((id) => (id && mongoose.Types.ObjectId.isValid(String(id)) ? String(id) : null))
    .filter(Boolean);
  for (const id of ids) map.set(id, false);
  if (!ids.length) return map;

  const oidProfiles = ids.map((id) => new mongoose.Types.ObjectId(id));
  const matches = await LeadMatch.find({
    user_id: userObjectId,
    lead_profile_id: { $in: oidProfiles },
  })
    .select('lead_profile_id _id conversation_id')
    .lean();
  if (!matches.length) return map;
  const byProfile = new Map();
  for (const m of matches) {
    const pid = String(m.lead_profile_id);
    if (!byProfile.has(pid)) {
      byProfile.set(pid, { matchIds: new Set(), convoIds: new Set() });
    }
    const bucket = byProfile.get(pid);
    bucket.matchIds.add(String(m._id));
    if (m.conversation_id) bucket.convoIds.add(String(m.conversation_id));
  }
  const allMatchIds = matches.map((m) => m._id).filter(Boolean);
  const allConvoIds = [...new Set(matches.map((m) => m.conversation_id).filter(Boolean))];
  const orClause = [];
  if (allMatchIds.length) orClause.push({ lead_match_id: { $in: allMatchIds } });
  if (allConvoIds.length) orClause.push({ conversation_id: { $in: allConvoIds } });
  if (!orClause.length) return map;
  const logs = await NurtureLog.find({
    user_id: userObjectId,
    meeting_booked: true,
    $or: orClause,
  })
    .select('lead_match_id conversation_id')
    .lean();
  const booked = new Set();
  for (const log of logs) {
    const mid = log.lead_match_id ? String(log.lead_match_id) : null;
    const cid = log.conversation_id ? String(log.conversation_id) : null;
    for (const [pid, { matchIds, convoIds }] of byProfile) {
      if (mid && matchIds.has(mid)) booked.add(pid);
      if (cid && convoIds.has(cid)) booked.add(pid);
    }
  }
  for (const id of ids) {
    map.set(id, booked.has(id));
  }
  return map;
}
