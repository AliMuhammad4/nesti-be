import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import LeadAttribution from '../../models/LeadAttribution.js';

/**
 * Keeps LeadProfile.lifecycle.status aligned with aggregate outcomes of all
 * LeadMatch rows for this profile (same workspace user).
 */
export async function recomputeLeadProfileLifecycle(userId, leadProfileId) {
  if (!leadProfileId) return;
  const matches = await LeadMatch.find({
    user_id: userId,
    lead_profile_id: leadProfileId,
  })
    .select('match_status')
    .lean();
  if (!matches.length) return;

  const anyWon = matches.some((m) => m.match_status === 'converted');
  const allLost =
    matches.length > 0 && matches.every((m) => m.match_status === 'closed_lost');

  let lifecycleStatus;
  if (anyWon) lifecycleStatus = 'customer';
  else if (allLost) lifecycleStatus = 'closed_lost';
  else lifecycleStatus = 'active';

  await LeadProfile.updateOne(
    { _id: leadProfileId, 'ownership.user_id': userId },
    { $set: { 'lifecycle.status': lifecycleStatus } }
  );
}

/**
 * Attribution.converted reflects whether this specific inquiry (match) is won.
 * Prefers lead_match_id (new rows); falls back to lead_profile_id + session_id for legacy attributions.
 */
export async function syncLeadAttributionForMatchStatus(leadMatch, matchStatus) {
  const isConverted = matchStatus === 'converted';
  const matchId = leadMatch._id;
  const profileId = leadMatch.lead_profile_id;
  const sessionId =
    leadMatch.compatibility_factors && typeof leadMatch.compatibility_factors === 'object'
      ? leadMatch.compatibility_factors.session_id
      : null;

  const byMatch = await LeadAttribution.updateMany(
    { lead_match_id: matchId },
    { $set: { converted: isConverted } }
  );
  if (byMatch.matchedCount > 0) return;

  if (profileId && sessionId) {
    await LeadAttribution.updateMany(
      { lead_profile_id: profileId, session_id: sessionId },
      { $set: { converted: isConverted } }
    );
  }
}
