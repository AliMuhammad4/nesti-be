import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import NurtureLog from '../../models/NurtureLog.js';
import { normalizeProfileIdList } from './leadQueryUtils.js';

function initFalseProfileMap(ids) {
  const map = new Map();
  for (const id of ids) map.set(id, false);
  return map;
}

function buildLinkIndexesFromMatches(matches = []) {
  const byProfile = new Map();
  const matchToProfile = new Map();
  const convoToProfile = new Map();
  for (const m of matches) {
    const pid = m.lead_profile_id ? String(m.lead_profile_id) : '';
    if (!pid) continue;
    if (!byProfile.has(pid)) {
      byProfile.set(pid, { matchIds: new Set(), convoIds: new Set() });
    }
    const bucket = byProfile.get(pid);
    bucket.matchIds.add(String(m._id));
    if (m.conversation_id) bucket.convoIds.add(String(m.conversation_id));
    matchToProfile.set(String(m._id), pid);
    if (m.conversation_id) convoToProfile.set(String(m.conversation_id), pid);
  }
  return { byProfile, matchToProfile, convoToProfile };
}

async function fetchNurtureMeetingBookedLogs(userObjectId, orClause, select) {
  if (!orClause.length) return [];
  return NurtureLog.find({
    user_id: userObjectId,
    meeting_booked: true,
    $or: orClause,
  })
    .select(select)
    .lean();
}

function markBookedFromBucketLogs(byProfile, logs) {
  const booked = new Set();
  for (const log of logs) {
    const mid = log.lead_match_id ? String(log.lead_match_id) : null;
    const cid = log.conversation_id ? String(log.conversation_id) : null;
    for (const [pid, { matchIds, convoIds }] of byProfile) {
      if (mid && matchIds.has(mid)) booked.add(pid);
      if (cid && convoIds.has(cid)) booked.add(pid);
    }
  }
  return booked;
}

/**
 * Fast path for list views: indexed NurtureLog lookup by profile id, with page-row
 * match/conversation fallback for legacy logs missing lead_profile_id.
 */
export async function buildNurtureConsultationBookedFromLeadMatches(userObjectId, leadMatches, profileIds) {
  const ids = normalizeProfileIdList(profileIds);
  const map = initFalseProfileMap(ids);
  if (!ids.length) return map;

  const { matchToProfile, convoToProfile } = buildLinkIndexesFromMatches(leadMatches);
  const oidProfiles = ids.map((id) => new mongoose.Types.ObjectId(id));
  const orClause = [{ lead_profile_id: { $in: oidProfiles } }];
  const pageMatchIds = (leadMatches || []).map((m) => m._id).filter(Boolean);
  const pageConvoIds = [...new Set((leadMatches || []).map((m) => m.conversation_id).filter(Boolean))];
  if (pageMatchIds.length) orClause.push({ lead_match_id: { $in: pageMatchIds } });
  if (pageConvoIds.length) orClause.push({ conversation_id: { $in: pageConvoIds } });

  const logs = await fetchNurtureMeetingBookedLogs(
    userObjectId,
    orClause,
    'lead_profile_id lead_match_id conversation_id',
  );

  for (const log of logs) {
    const directPid = log.lead_profile_id ? String(log.lead_profile_id) : '';
    if (directPid && ids.includes(directPid)) {
      map.set(directPid, true);
      continue;
    }
    const mid = log.lead_match_id ? String(log.lead_match_id) : '';
    const pidFromMatch = mid ? matchToProfile.get(mid) : null;
    if (pidFromMatch && ids.includes(pidFromMatch)) {
      map.set(pidFromMatch, true);
      continue;
    }
    const cid = log.conversation_id ? String(log.conversation_id) : '';
    const pidFromConvo = cid ? convoToProfile.get(cid) : null;
    if (pidFromConvo && ids.includes(pidFromConvo)) {
      map.set(pidFromConvo, true);
    }
  }

  return map;
}

export async function buildNurtureConsultationBookedFromEmailByProfileIds(userObjectId, profileIds) {
  const ids = normalizeProfileIdList(profileIds);
  const map = initFalseProfileMap(ids);
  if (!ids.length) return map;

  const oidProfiles = ids.map((id) => new mongoose.Types.ObjectId(id));
  const matches = await LeadMatch.find({
    user_id: userObjectId,
    lead_profile_id: { $in: oidProfiles },
  })
    .select('lead_profile_id _id conversation_id')
    .lean();
  if (!matches.length) return map;

  const { byProfile } = buildLinkIndexesFromMatches(matches);
  const allMatchIds = matches.map((m) => m._id).filter(Boolean);
  const allConvoIds = [...new Set(matches.map((m) => m.conversation_id).filter(Boolean))];
  const orClause = [];
  if (allMatchIds.length) orClause.push({ lead_match_id: { $in: allMatchIds } });
  if (allConvoIds.length) orClause.push({ conversation_id: { $in: allConvoIds } });

  const logs = await fetchNurtureMeetingBookedLogs(
    userObjectId,
    orClause,
    'lead_match_id conversation_id',
  );
  const booked = markBookedFromBucketLogs(byProfile, logs);
  for (const id of ids) map.set(id, booked.has(id));
  return map;
}

/** Attach profile-level nurture consultation flag (NurtureLog meeting_booked) to lead detail payloads. */
export async function enrichLeadDetailWithProfileConsultation(userId, profile, leadDetail) {
  if (!profile?._id || !leadDetail) return leadDetail;
  const nurtureMap = await buildNurtureConsultationBookedFromEmailByProfileIds(userId, [profile._id]);
  const appointmentBooked = String(leadDetail.appointment_status || '').toLowerCase() === 'booked';
  return {
    ...leadDetail,
    nurture_consultation_booked: appointmentBooked && Boolean(nurtureMap.get(String(profile._id))),
  };
}
