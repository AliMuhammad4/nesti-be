import mongoose from 'mongoose';
import LeadMatch from '../../../models/LeadMatch.js';
import Referral from '../../../models/Referral.js';
import User from '../../../models/User.js';
import { createReferralForUser } from '../referralService.js';

function referralSummary(doc) {
  if (!doc?._id) return null;
  return { id: String(doc._id), status: doc.status || '', existing: true };
}

export function inviterIdFromInvite(invite) {
  const inviterOid = invite?.inviter_user_id?._id || invite?.inviter_user_id;
  return mongoose.Types.ObjectId.isValid(String(inviterOid))
    ? new mongoose.Types.ObjectId(String(inviterOid))
    : null;
}

async function resolveSourceLeadMatchId(invite, inviterId) {
  if (!inviterId) return null;
  const leadMatchIdRaw = String(invite?.metadata?.lead_match_id || '').trim();
  const convIdRaw = String(invite?.source_conversation_id || '').trim();

  if (mongoose.Types.ObjectId.isValid(leadMatchIdRaw)) {
    const rawOid = new mongoose.Types.ObjectId(leadMatchIdRaw);
    const byLeadId = await LeadMatch.findOne({ _id: rawOid, user_id: inviterId }).select('_id').lean();
    if (byLeadId?._id) return String(byLeadId._id);
    const byConv = await LeadMatch.findOne({ user_id: inviterId, conversation_id: rawOid })
      .select('_id')
      .lean();
    if (byConv?._id) return String(byConv._id);
  }

  if (mongoose.Types.ObjectId.isValid(convIdRaw)) {
    const byConv = await LeadMatch.findOne({
      user_id: inviterId,
      conversation_id: new mongoose.Types.ObjectId(convIdRaw),
    })
      .select('_id')
      .lean();
    if (byConv?._id) return String(byConv._id);
  }

  return null;
}

export async function findLeadReferralForInviteTarget({ invite, inviterId, targetUserId, resolvedLeadId = null }) {
  if (!inviterId) return null;
  const leadId = resolvedLeadId || (await resolveSourceLeadMatchId(invite, inviterId));

  if (leadId) {
    const byExact = await Referral.findOne({
      user_id: inviterId,
      target_user_id: targetUserId,
      lead_match_id: new mongoose.Types.ObjectId(leadId),
      status: { $in: ['pending', 'accepted'] },
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (byExact) return referralSummary(byExact);
  }

  const inflight = await Referral.find({
    user_id: inviterId,
    target_user_id: targetUserId,
    status: { $in: ['pending', 'accepted'] },
  })
    .select('_id status lead_match_id')
    .sort({ updatedAt: -1 })
    .lean();
  if (!inflight.length) return null;
  if (!leadId) return referralSummary(inflight[0]);

  const canonical = await LeadMatch.findById(leadId).select('conversation_id lead_profile_id').lean();
  const canonConv = canonical?.conversation_id ? String(canonical.conversation_id) : '';
  const canonProfile = canonical?.lead_profile_id ? String(canonical.lead_profile_id) : '';

  for (const r of inflight) {
    if (String(r.lead_match_id) === leadId) return referralSummary(r);
    const src = await LeadMatch.findById(r.lead_match_id).select('conversation_id lead_profile_id').lean();
    if (!src) continue;
    if (canonConv && src.conversation_id && String(src.conversation_id) === canonConv) {
      return referralSummary(r);
    }
    if (canonProfile && src.lead_profile_id && String(src.lead_profile_id) === canonProfile) {
      return referralSummary(r);
    }
  }

  return null;
}

export async function createOrGetLeadReferralFromInvite({ invite, inviterId, targetUserId }) {
  const resolvedLeadId = await resolveSourceLeadMatchId(invite, inviterId);
  if (!resolvedLeadId) return null;

  const existing = await findLeadReferralForInviteTarget({
    invite,
    inviterId,
    targetUserId,
    resolvedLeadId,
  });
  if (existing) return existing;

  const newUser = await User.findById(targetUserId).select('role').lean();
  const vertical = String(invite?.intended_role || newUser?.role || 'agent').trim().toLowerCase();
  const result = await createReferralForUser(invite.inviter_user_id, {
    target_user_id: targetUserId,
    lead_match_id: resolvedLeadId,
    target_vertical: vertical || 'agent',
    status: 'pending',
    notes: 'Auto-created from lead invite link signup.',
  });
  if (result?.ok) return result.referral || null;
  if (result?.code === 409) {
    return findLeadReferralForInviteTarget({ invite, inviterId, targetUserId, resolvedLeadId });
  }
  return null;
}
