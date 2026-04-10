import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import { formatLeadProfileSummary } from './leadProfileFormat.js';
import { buildAppointmentStatusByProfileIds } from './leadAppointmentStatus.js';
import { buildNurtureConsultationBookedFromEmailByProfileIds } from './leadNurtureBookingStatus.js';
import { ICP_TIERS } from './leadQueryUtils.js';
import { buildPaginationMeta, PAGINATION_PRESETS, parsePageLimitPagination } from '../../utils/pagination.js';

export function ownerQuery(userId) {
  return { $or: [{ 'ownership.user_id': String(userId) }, { owner_user_id: String(userId) }] };
}

export function skipAppointmentStatusFromQuery(q) {
  const v = String(q?.include_appointment_status ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

export function buildProfileEmptyState(icpTier) {
  return icpTier
    ? { reason: `No lead profiles match icp_tier=${icpTier}.`, action: 'Try a different ICP tier or review ICP settings to widen matches.' }
    : { reason: 'No lead profiles found yet.', action: 'Capture new leads or remove filters to populate this view.' };
}

export async function fetchProfilesForIcpTier({ userObjectId, userId, icpTier, skip, limit }) {
  const sharedStages = [
    { $match: { user_id: userObjectId, lead_profile_id: { $ne: null }, 'icp_fit.fit_tier': icpTier } },
    { $group: { _id: '$lead_profile_id' } },
    { $match: { _id: { $ne: null } } },
    { $lookup: { from: LeadProfile.collection.collectionName, localField: '_id', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: false } },
    { $match: { $or: [{ 'profile.ownership.user_id': userObjectId }, { 'profile.owner_user_id': userId }, { 'profile.owner_user_id': userObjectId }] } },
  ];

  const [countRows, profiles] = await Promise.all([
    LeadMatch.aggregate([...sharedStages, { $count: 'total' }]),
    LeadMatch.aggregate([...sharedStages, { $replaceRoot: { newRoot: '$profile' } }, { $sort: { updatedAt: -1, createdAt: -1 } }, { $skip: skip }, { $limit: limit }]),
  ]);

  return { total: countRows[0]?.total ?? 0, profiles };
}

export async function fetchProfilesDefault({ userId, skip, limit }) {
  const q = ownerQuery(userId);
  const [total, profiles] = await Promise.all([
    LeadProfile.countDocuments(q),
    LeadProfile.find(q).sort({ updatedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);
  return { total, profiles };
}

export async function enrichAndFormatProfiles(profiles, userObjectId, skipAppointment) {
  const profileIds = profiles.map((p) => p._id);
  const [apptMap, nurtureBookedMap] = await Promise.all([
    skipAppointment ? Promise.resolve(new Map()) : buildAppointmentStatusByProfileIds(userObjectId, profileIds),
    buildNurtureConsultationBookedFromEmailByProfileIds(userObjectId, profileIds),
  ]);
  return profiles.map((profile) =>
    formatLeadProfileSummary(profile, {
      appointment_status: skipAppointment ? 'not_booked' : apptMap.get(String(profile._id)) ?? 'not_booked',
      nurture_consultation_booked: nurtureBookedMap.get(String(profile._id)) ?? false,
      omit_ownership: true,
    }),
  );
}

export { ICP_TIERS, buildPaginationMeta, PAGINATION_PRESETS, parsePageLimitPagination };
