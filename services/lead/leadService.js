import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import LeadAttribution from '../../models/LeadAttribution.js';
import ChatMessage from '../../models/ChatMessage.js';

function normPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function dedupeContactForSummary(contact) {
  if (!contact || typeof contact !== 'object') return contact;
  const c = { ...contact };
  const email = String(c.email || '').trim().toLowerCase();
  const canonEmail = String(c.canonical_email || '').trim().toLowerCase();
  if (canonEmail && email && canonEmail === email) delete c.canonical_email;
  const ph = normPhoneDigits(c.phone);
  const cph = normPhoneDigits(c.canonical_phone);
  if (ph && cph && ph === cph) delete c.canonical_phone;
  return c;
}

function hasStructuredBudgetRange(bp) {
  const min = bp?.min_budget;
  const max = bp?.max_budget;
  return (
    min != null &&
    max != null &&
    Number.isFinite(Number(min)) &&
    Number.isFinite(Number(max))
  );
}

function mapLeadProfileForApi(profile, profType) {
  const p = profile || {};
  return {
    intent: p.intent || null,
    contact: {
      full_name: p.identity?.full_name || null,
      email: p.identity?.email || null,
      phone: p.identity?.phone || null,
      canonical_email: p.identity?.canonical_email || null,
      canonical_phone: p.identity?.canonical_phone || null,
      preferred_contact_method: p.contact_preferences?.preferred_contact_method || null,
      best_time_to_contact: p.contact_preferences?.best_time_to_contact || null,
    },
    property: {
      location: p.property?.location || null,
      address: p.property?.address || null,
      budget: p.property?.budget || p.property?.expected_price || p.budget_profile?.latest_budget_text || null,
      timeline: p.property?.timeline || p.qualification?.mortgage_broker?.mortgage_timeline || null,
      bedrooms: p.property?.bedrooms || null,
      bathrooms: p.property?.bathrooms || null,
      square_footage: p.property?.square_footage || null,
      property_type: p.property?.property_type || null,
      must_have_features: p.property?.must_have_features || null,
      parking_required: p.property?.parking_required || null,
      backyard_needed: p.property?.backyard_needed || null,
      school_district_important: p.property?.school_district_important || null,
    },
    qualification:
      profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER
        ? {
            mortgage_timeline: p.qualification?.mortgage_broker?.mortgage_timeline || null,
            pre_approval_status:
              p.qualification?.mortgage_broker?.pre_approval_status ||
              p.qualification?.mortgage_broker?.mortgage_status ||
              null,
            credit_score_range: p.qualification?.mortgage_broker?.credit_score_range || null,
            employment_status: p.qualification?.mortgage_broker?.employment_status || null,
            household_income: p.qualification?.mortgage_broker?.household_income || null,
            down_payment_readiness: p.qualification?.mortgage_broker?.down_payment_readiness || null,
            purchase_purpose: p.qualification?.mortgage_broker?.purchase_purpose || null,
            urgency_signal: p.qualification?.mortgage_broker?.urgency_signal || null,
          }
        : profType === PROFESSIONAL_TYPE.LAWYER
          ? {
              transaction_stage: p.qualification?.lawyer?.transaction_stage || null,
              closing_timeline: p.qualification?.lawyer?.closing_timeline || null,
              transaction_type: p.qualification?.lawyer?.transaction_type || null,
              property_value: p.qualification?.lawyer?.property_value || null,
              mortgage_status: p.qualification?.lawyer?.mortgage_status || null,
              realtor_involved: p.qualification?.lawyer?.realtor_involved || null,
              first_time_buyer: p.qualification?.lawyer?.first_time_buyer || null,
              legal_services_needed: p.qualification?.lawyer?.legal_services_needed || null,
            }
          : {
              mortgage_status: p.qualification?.agent?.mortgage_status || null,
              realtor_status: p.qualification?.agent?.realtor_status || null,
              motivation_reason: p.qualification?.agent?.motivation_reason || null,
              viewing_readiness: p.qualification?.agent?.viewing_readiness || null,
              living_situation: p.qualification?.agent?.living_situation || null,
              urgency_readiness: p.qualification?.agent?.urgency_readiness || null,
            },
  };
}

function formatLeadProfileSummary(profile, options = {}) {
  const { appointment_status: appointmentStatusOpt } = options;
  const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile, profType);
  const ownership = profile.ownership || {};
  const { professional_type: _omitProfType, ...ownershipRest } = ownership;

  const rawBp = profile.budget_profile || {};
  const propBudgetStr = String(profileView.property?.budget || '').trim();
  const latestText = String(rawBp.latest_budget_text || '').trim();
  const budget_profile = { ...rawBp };
  if (latestText && propBudgetStr && latestText === propBudgetStr) {
    delete budget_profile.latest_budget_text;
  }

  const property = { ...profileView.property };
  if (hasStructuredBudgetRange(budget_profile)) {
    delete property.budget;
  }

  const intent = profile.intent || null;
  let intent_summary = { ...(profile.intent_summary || {}) };
  if (intent != null && String(intent_summary.primary_intent || '') === String(intent)) {
    const { primary_intent: _pi, ...isRest } = intent_summary;
    intent_summary = isRest;
  }

  const stats = { ...(profile.stats || {}) };
  let lifecycle = { ...(profile.lifecycle || {}) };
  try {
    const sLast = stats.last_seen_at != null ? new Date(stats.last_seen_at).toISOString() : null;
    const lLast = lifecycle.last_seen_at != null ? new Date(lifecycle.last_seen_at).toISOString() : null;
    if (sLast && lLast && sLast === lLast) {
      delete lifecycle.last_seen_at;
    }
  } catch {
    /* ignore date compare */
  }

  const out = {
    id: String(profile._id),
    professional_type: profType,
    intent,
    contact: dedupeContactForSummary(profileView.contact),
    property,
    qualification: profileView.qualification,
    ownership: ownershipRest,
    lifecycle,
    ...(Object.keys(intent_summary).length ? { intent_summary } : {}),
    ...(Object.keys(budget_profile).length ? { budget_profile } : {}),
    stats,
    lead_refs: profile.lead_refs || [],
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };

  if (appointmentStatusOpt != null) {
    out.appointment_status = appointmentStatusOpt;
  }

  return out;
}

async function buildAppointmentStatusByProfileIds(userObjectId, profileIds) {
  const map = new Map();
  const ids = (profileIds || []).map((id) => String(id)).filter(Boolean);
  if (!ids.length) return map;

  const matches = await LeadMatch.find({
    user_id: userObjectId,
    lead_profile_id: { $in: ids },
  })
    .select('lead_profile_id match_status conversation_id')
    .lean();

  const convoIds = [...new Set(matches.map((m) => m.conversation_id).filter(Boolean).map(String))];
  const conversations =
    convoIds.length > 0
      ? await ChatConversation.find({ _id: { $in: convoIds } })
          .select('calendly_booking_status')
          .lean()
      : [];
  const convoById = new Map(conversations.map((c) => [String(c._id), c]));

  const byProfile = new Map();
  for (const m of matches) {
    const pid = String(m.lead_profile_id);
    if (!pid) continue;
    const convo = convoById.get(String(m.conversation_id)) || {};
    const st = resolveAppointmentStatus(m.match_status, convo.calendly_booking_status);
    if (!byProfile.has(pid)) byProfile.set(pid, []);
    byProfile.get(pid).push(st);
  }

  for (const pid of ids) {
    const statuses = byProfile.get(pid) || [];
    if (!statuses.length) {
      map.set(pid, 'not_booked');
      continue;
    }
    if (statuses.includes('booked')) map.set(pid, 'booked');
    else if (statuses.includes('canceled')) map.set(pid, 'canceled');
    else map.set(pid, 'not_booked');
  }

  return map;
}

function resolveAppointmentStatus(matchStatus, calendlyBookingStatus) {
  const c = String(calendlyBookingStatus || '').trim().toLowerCase();
  if (c === 'booked' || c === 'canceled') return c;
  const m = String(matchStatus || '').trim().toLowerCase();
  if (m === 'consult_booked') return 'booked';
  if (m === 'nurturing') return 'canceled';
  return 'not_booked';
}

const ICP_TIERS = new Set(['perfect_match', 'good_match', 'low_match']);

const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;

function parseListPagination(query = {}) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const rawLimit = parseInt(String(query.limit ?? ''), 10);
  const limit = Math.min(
    LIST_MAX_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : LIST_DEFAULT_LIMIT),
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function buildPaginationMeta(page, limit, total) {
  const total_pages = total > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    total_pages,
    has_more: page < total_pages,
  };
}

export const getLeads = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const q = req.query || {};
    const { page, limit, skip } = parseListPagination(q);
    const { embedToken, intent, grade, status } = q;
    const match = { user_id: userId };
    if (status) match.match_status = status;
    if (grade) match.lead_type = new RegExp(`^${grade}_`);
    if (intent === 'buy' || intent === 'sell') {
      const suffix = intent === 'sell' ? 'seller' : '(buyer|client)';
      match.lead_type = new RegExp(`${suffix}$`);
    }
    if (embedToken) match['compatibility_factors.embed_token'] = embedToken;

    const [total, leadMatches] = await Promise.all([
      LeadMatch.countDocuments(match),
      LeadMatch.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    if (!total) {
      return res.json({
        success: true,
        leads: [],
        pagination: buildPaginationMeta(page, limit, 0),
      });
    }

    const profileIds = leadMatches.map((m) => m.lead_profile_id).filter(Boolean);
    const convoIds = leadMatches.map((m) => m.conversation_id).filter(Boolean);
    const [profiles, conversations] = await Promise.all([
      LeadProfile.find({ _id: { $in: profileIds } }).lean(),
      ChatConversation.find({ _id: { $in: convoIds } }).lean(),
    ]);

    const profileById = new Map(profiles.map((p) => [String(p._id), p]));
    const convoById = new Map(conversations.map((c) => [String(c._id), c]));

    const leads = leadMatches.map((m) => {
      const profile = profileById.get(String(m.lead_profile_id)) || {};
      const convo = convoById.get(String(m.conversation_id)) || {};
      const profType = m.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
      const profileView = mapLeadProfileForApi(profile, profType);
      return {
        id: String(m._id),
        professional_type: profType,
        intent: profileView.intent,
        lead_type: m.lead_type,
        grade: m.lead_type?.split('_')[0] || null,
        score: m.match_score,
        status: m.match_status,
        contact: profileView.contact,
        property: profileView.property,
        qualification: profileView.qualification,
        appointment_status: resolveAppointmentStatus(m.match_status, convo.calendly_booking_status),
        embed_token: m.compatibility_factors?.embed_token || null,
        session_id: m.compatibility_factors?.session_id || convo.session_id || null,
        conversation_id: String(m.conversation_id || ''),
        created_at: m.createdAt,
        updated_at: m.updatedAt,
      };
    });

    return res.json({
      success: true,
      leads,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (error) {
    return next(error);
  }
};

export const getLeadById = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const leadMatch = await LeadMatch.findOne({ _id: id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    const [profile, convo] = await Promise.all([
      leadMatch.lead_profile_id ? LeadProfile.findById(leadMatch.lead_profile_id).lean() : null,
      leadMatch.conversation_id ? ChatConversation.findById(leadMatch.conversation_id).lean() : null,
    ]);
    const profType = leadMatch.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
    const profileView = mapLeadProfileForApi(profile, profType);

    const lead = {
      id: String(leadMatch._id),
      professional_type: profType,
      intent: profileView.intent,
      lead_type: leadMatch.lead_type,
      grade: leadMatch.lead_type?.split('_')[0] || null,
      score: leadMatch.match_score,
      status: leadMatch.match_status,
      contact: profileView.contact,
      property: profileView.property,
      qualification: profileView.qualification,
      appointment_status: resolveAppointmentStatus(leadMatch.match_status, convo?.calendly_booking_status),
      embed_token: leadMatch.compatibility_factors?.embed_token || null,
      session_id: leadMatch.compatibility_factors?.session_id || convo?.session_id || null,
      conversation_id: String(leadMatch.conversation_id || ''),
      created_at: leadMatch.createdAt,
      updated_at: leadMatch.updatedAt,
    };
    return res.json({ success: true, lead });
  } catch (error) {
    return next(error);
  }
};

export const getLeadProfileById = async (req, res, next) => {
  try {
    const userId = String(req.user._id);
    const { profileId } = req.params;
    const profile = await LeadProfile.findOne({
      _id: profileId,
      $or: [{ 'ownership.user_id': userId }, { owner_user_id: userId }],
    }).lean();
    if (!profile) return res.status(404).json({ success: false, message: 'Lead profile not found' });

    const apptMap = await buildAppointmentStatusByProfileIds(req.user._id, [profile._id]);
    const appointment_status = apptMap.get(String(profile._id)) ?? 'not_booked';

    return res.json({
      success: true,
      lead_profile: formatLeadProfileSummary(profile, { appointment_status }),
    });
  } catch (error) {
    return next(error);
  }
};

export const getLeadProfiles = async (req, res, next) => {
  try {
    const userId = String(req.user._id);
    const userObjectId = req.user._id;
    const q = req.query || {};
    const { page, limit, skip } = parseListPagination(q);
    const icpTier = String(q.icp_tier || '').trim().toLowerCase();

    let profileIdFilter = null;
    if (icpTier) {
      if (!ICP_TIERS.has(icpTier)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid icp_tier. Use perfect_match, good_match, or low_match',
        });
      }
      const matchIcp = {
        user_id: userObjectId,
        lead_profile_id: { $ne: null },
        'icp_fit.fit_tier': icpTier,
      };
      const distinctIds = await LeadMatch.distinct('lead_profile_id', matchIcp);
      profileIdFilter = distinctIds.filter(Boolean).map((id) => String(id));
      if (!profileIdFilter.length) {
        return res.json({
          success: true,
          lead_profiles: [],
          pagination: buildPaginationMeta(page, limit, 0),
        });
      }
    }

    const profileQuery = profileIdFilter
      ? {
          _id: { $in: profileIdFilter },
          $or: [{ 'ownership.user_id': userId }, { owner_user_id: userId }],
        }
      : { $or: [{ 'ownership.user_id': userId }, { owner_user_id: userId }] };

    const [total, profiles] = await Promise.all([
      LeadProfile.countDocuments(profileQuery),
      LeadProfile.find(profileQuery)
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const profileIds = profiles.map((p) => p._id);
    const apptMap = await buildAppointmentStatusByProfileIds(userObjectId, profileIds);
    const lead_profiles = profiles.map((profile) =>
      formatLeadProfileSummary(profile, {
        appointment_status: apptMap.get(String(profile._id)) ?? 'not_booked',
      }),
    );

    return res.json({
      success: true,
      lead_profiles,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (error) {
    return next(error);
  }
};

export const getLeadsByProfileId = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { profileId } = req.params;
    const { page, limit, skip } = parseListPagination(req.query || {});

    const profile = await LeadProfile.findOne({
      _id: profileId,
      $or: [{ 'ownership.user_id': String(userId) }, { owner_user_id: String(userId) }],
    }).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Lead profile not found' });
    }

    const listMatch = { user_id: userId, lead_profile_id: profileId };
    const [total, leadMatches] = await Promise.all([
      LeadMatch.countDocuments(listMatch),
      LeadMatch.find(listMatch).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const convoIds = leadMatches.map((m) => m.conversation_id).filter(Boolean);
    const conversations = await ChatConversation.find({ _id: { $in: convoIds } }).lean();
    const convoById = new Map(conversations.map((c) => [String(c._id), c]));
    const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
    const profileView = mapLeadProfileForApi(profile, profType);

    const leads = leadMatches.map((m) => {
      const convo = convoById.get(String(m.conversation_id)) || {};
      return {
        id: String(m._id),
        professional_type: m.compatibility_factors?.professional_type || profType,
        intent: profileView.intent,
        lead_type: m.lead_type,
        grade: m.lead_type?.split('_')[0] || null,
        score: m.match_score,
        status: m.match_status,
        appointment_status: resolveAppointmentStatus(m.match_status, convo.calendly_booking_status),
        icp_fit: m.icp_fit || null,
        embed_token: m.compatibility_factors?.embed_token || null,
        session_id: m.compatibility_factors?.session_id || convo.session_id || null,
        conversation_id: String(m.conversation_id || ''),
        created_at: m.createdAt,
        updated_at: m.updatedAt,
      };
    });

    return res.json({
      success: true,
      profile_id: String(profile._id),
      leads,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (error) {
    return next(error);
  }
};

export const getLeadConversation = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { page, limit, skip } = parseListPagination(req.query || {});

    const leadMatch = await LeadMatch.findOne({ _id: id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!leadMatch.conversation_id) {
      return res.json({
        success: true,
        lead_id: id,
        conversation_id: null,
        messages: [],
        pagination: buildPaginationMeta(page, limit, 0),
      });
    }

    const convFilter = { conversation_id: leadMatch.conversation_id };
    const [total, messages] = await Promise.all([
      ChatMessage.countDocuments(convFilter),
      ChatMessage.find(convFilter).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    ]);

    const conversationMessages = messages.map((m) => ({
      id: String(m._id),
      role: m.role,
      content: m.content,
      intent: m.intent || null,
      created_at: m.createdAt,
    }));
    return res.json({
      success: true,
      lead_id: id,
      conversation_id: String(leadMatch.conversation_id),
      messages: conversationMessages,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteLeadById = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const leadMatch = await LeadMatch.findOne({ _id: id, user_id: userId });
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    const profileId = leadMatch.lead_profile_id;
    const conversationId = leadMatch.conversation_id;
    const leadMatchId = leadMatch._id;
    await LeadMatch.deleteOne({ _id: leadMatchId });

    if (profileId) {
      await LeadProfile.findByIdAndUpdate(profileId, { $pull: { lead_refs: leadMatchId } });
      const remainingLeadMatches = await LeadMatch.countDocuments({ lead_profile_id: profileId });
      if (remainingLeadMatches === 0) {
        await LeadProfile.deleteOne({ _id: profileId });
        await LeadAttribution.deleteMany({ lead_profile_id: profileId });
      }
    }
    if (conversationId) {
      await ChatConversation.deleteOne({ _id: conversationId });
      await ChatMessage.deleteMany({ conversation_id: conversationId });
    }
    return res.json({
      success: true,
      message: 'Lead and related conversation were deleted successfully',
    });
  } catch (error) {
    return next(error);
  }
};

