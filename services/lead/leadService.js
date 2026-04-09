import mongoose from 'mongoose';
import { buildLeadConversionPack } from '../conversion/buildLeadConversionPack.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import LeadAttribution from '../../models/LeadAttribution.js';
import ChatMessage from '../../models/ChatMessage.js';
import {
  getBuyerPropertyMatches,
  getBuyerMatchesForSellerProperty,
} from '../agent/propertyMatch/matchService.js';
import { parsePageLimitPagination, buildPaginationMeta, PAGINATION_PRESETS } from '../../utils/pagination.js';
import { formatLeadProfileSummary } from './leadProfileFormat.js';
import { buildAppointmentStatusByProfileIds } from './leadAppointmentStatus.js';
import {
  truthyQueryFlag,
  includeConversionInLeadDetail,
  ICP_TIERS,
} from './leadQueryUtils.js';
import {
  mapLeadMatchToListRow,
  mapLeadMatchToDetail,
  mapLeadMatchUnderProfile,
} from './leadResponseMappers.js';
import {
  buildCollectionEmptyState,
  buildDecisionSupport,
  buildFunnelTelemetry,
  buildLeadTrust,
} from './leadExperienceContract.js';
import { recordLeadViewIfNeeded } from '../analytics/leadKpiService.js';

export const recordLeadView = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const leadMatch = await LeadMatch.findOne({ _id: id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    const result = await recordLeadViewIfNeeded({
      user_id: userId,
      lead_match_id: leadMatch._id,
      conversation_id: leadMatch.conversation_id || null,
      grade: leadMatch.lead_type?.split('_')[0] || null,
      metadata: { match_status: leadMatch.match_status },
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

export const getLeads = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const q = req.query || {};
    const { page, limit, skip } = parsePageLimitPagination(q, PAGINATION_PRESETS.leadList);
    const { embedToken, intent, grade, status } = q;
    const includeConversion = truthyQueryFlag(q.include_conversion);
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
        empty_state: buildCollectionEmptyState('leads'),
        pagination: buildPaginationMeta({ page, limit, total: 0 }),
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

    const leads = leadMatches.map((m) =>
      mapLeadMatchToListRow(
        m,
        profileById.get(String(m.lead_profile_id)) || {},
        convoById.get(String(m.conversation_id)) || {},
        includeConversion,
      ),
    );

    return res.json({
      success: true,
      leads,
      empty_state: null,
      pagination: buildPaginationMeta({ page, limit, total }),
    });
  } catch (error) {
    return next(error);
  }
};

export const getLeadById = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const query = req.query || {};
    const includeConversion = includeConversionInLeadDetail(query);
    const leadMatch = await LeadMatch.findOne({ _id: id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    const [profile, convo] = await Promise.all([
      leadMatch.lead_profile_id ? LeadProfile.findById(leadMatch.lead_profile_id).lean() : null,
      leadMatch.conversation_id ? ChatConversation.findById(leadMatch.conversation_id).lean() : null,
    ]);

    const lead = mapLeadMatchToDetail(leadMatch, profile, convo, includeConversion);
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
    const { page, limit, skip } = parsePageLimitPagination(q, PAGINATION_PRESETS.leadList);
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
          empty_state: {
            reason: `No lead profiles match icp_tier=${icpTier}.`,
            action: 'Try a different ICP tier or review ICP settings to widen matches.',
          },
          pagination: buildPaginationMeta({ page, limit, total: 0 }),
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
      empty_state:
        lead_profiles.length === 0
          ? {
              reason: 'No lead profiles found yet.',
              action: 'Capture new leads or remove filters to populate this view.',
            }
          : null,
      pagination: buildPaginationMeta({ page, limit, total }),
    });
  } catch (error) {
    return next(error);
  }
};

export const getLeadsByProfileId = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { profileId } = req.params;
    const q = req.query || {};
    const { page, limit, skip } = parsePageLimitPagination(q, PAGINATION_PRESETS.leadList);

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

    const leads = leadMatches.map((m) =>
      mapLeadMatchUnderProfile(m, profile, convoById.get(String(m.conversation_id)) || {}),
    );

    return res.json({
      success: true,
      profile_id: String(profile._id),
      leads,
      empty_state:
        leads.length === 0
          ? buildCollectionEmptyState('profile_leads')
          : null,
      pagination: buildPaginationMeta({ page, limit, total }),
    });
  } catch (error) {
    return next(error);
  }
};

export const getLeadConversation = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { page, limit, skip } = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.leadList);

    const leadMatch = await LeadMatch.findOne({ _id: id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!leadMatch.conversation_id) {
      return res.json({
        success: true,
        lead_id: id,
        conversation_id: null,
        messages: [],
        empty_state: {
          reason: 'No conversation thread exists for this lead yet.',
          action: 'Start outreach from the lead card and message history will appear here.',
        },
        pagination: buildPaginationMeta({ page, limit, total: 0 }),
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
      empty_state:
        conversationMessages.length === 0
          ? {
              reason: 'Conversation thread is created but has no messages yet.',
              action: 'Send the first outreach message to activate this thread.',
            }
          : null,
      pagination: buildPaginationMeta({ page, limit, total }),
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

export const getLeadPropertyMatches = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const leadMatchId = req.params.id;
    const { page, limit, skip } = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.propertyMatches);

    if (!mongoose.Types.ObjectId.isValid(leadMatchId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }
    const leadMatch = await LeadMatch.findOne({ _id: leadMatchId, user_id: userId }).lean();
    if (!leadMatch) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    if (!leadMatch.lead_profile_id) {
      return res.status(200).json({
        success: true,
        property_matches: [],
        property_matches_context: null,
        conversion: null,
        message: 'No lead profile attached to this lead yet.',
        empty_state: {
          reason: 'Property matching requires a lead profile.',
          action: 'Complete lead qualification fields (intent, budget, location, timeline) to enable matches.',
        },
      });
    }
    const leadProfile = await LeadProfile.findById(leadMatch.lead_profile_id).lean();
    if (!leadProfile) {
      return res.status(200).json({
        success: true,
        property_matches: [],
        property_matches_context: null,
        conversion: null,
        message: 'Lead profile not found.',
        empty_state: {
          reason: 'Lead profile data is missing for this lead.',
          action: 'Re-run qualification or reconnect this lead to a valid profile.',
        },
      });
    }
    const isBuyer = /buy/i.test(leadProfile.intent || leadMatch.lead_type || '');
    const context = isBuyer ? 'buy' : 'sell';
    const [property_matches, conversation] = await Promise.all([
      isBuyer
        ? getBuyerPropertyMatches({ userId, leadProfile, signals: {} })
        : getBuyerMatchesForSellerProperty({ userId, leadProfile, signals: {} }),
      leadMatch.conversation_id
        ? ChatConversation.findById(leadMatch.conversation_id)
            .select('calendly_booking_status lead_reasons last_interaction_at intent')
            .lean()
        : Promise.resolve(null),
    ]);
    const conversion = buildLeadConversionPack({
      leadMatch,
      leadProfile,
      conversation,
      intent: context,
    });
    return res.json({
      success: true,
      lead_id: String(leadMatch._id),
      intent: context,
      property_matches: property_matches.slice(skip, skip + limit),
      property_matches_context: context,
      match_count: property_matches.length,
      conversion,
      decision_support: buildDecisionSupport(
        conversion,
        leadMatch.lead_type?.split('_')[0] || null,
        [
          leadMatch?.match_score != null ? `Lead score ${Number(leadMatch.match_score)}/100` : null,
          leadProfile?.property?.budget || leadProfile?.property?.expected_price
            ? `Budget/price: ${leadProfile?.property?.budget || leadProfile?.property?.expected_price}`
            : null,
          leadProfile?.property?.timeline ? `Timeline: ${leadProfile.property.timeline}` : null,
          leadProfile?.property?.location || leadProfile?.property?.address
            ? `Area: ${leadProfile.property.location || leadProfile.property.address}`
            : null,
        ].filter(Boolean),
      ),
      trust: buildLeadTrust({
        contact: {
          full_name: leadProfile?.identity?.full_name || null,
          email: leadProfile?.identity?.email || null,
          phone: leadProfile?.identity?.phone || null,
        },
        property: {
          intent: leadProfile?.intent || context,
          location: leadProfile?.property?.location || null,
          address: leadProfile?.property?.address || null,
          budget:
            leadProfile?.property?.budget ||
            leadProfile?.property?.expected_price ||
            leadProfile?.budget_profile?.latest_budget_text ||
            null,
          timeline: leadProfile?.property?.timeline || null,
        },
        qualification: leadProfile?.qualification || null,
        icpFit: leadMatch?.icp_fit || null,
      }),
      conversion_funnel: buildFunnelTelemetry(conversion),
      empty_state:
        property_matches.length === 0
          ? buildCollectionEmptyState('property_matches', { intent: context })
          : null,
      pagination: buildPaginationMeta({ page, limit, total: property_matches.length }),
    });
  } catch (error) {
    return next(error);
  }
};

export { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
