import ProfessionalProfile from '../models/ProfessionalProfile.js';
import User from '../models/User.js';
import { isValidProfessionalType, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { refreshCalendlySlugMismatchForUser } from '../services/calendly/calendlyAlignmentService.js';
import { scoreLeadAgainstIcp } from '../services/lead/icpScoringService.js';
import { evaluateProfessionalProfileSetup } from '../utils/professionalProfileSetup.js';
import { awardInviterMilestoneForUser } from '../services/referral/inviteService.js';
import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import IcpProfile from '../models/IcpProfile.js';
import ClientProfile from '../models/ClientProfile.js';
import { calculateAiCompatibilityScore } from '../services/matching/matchRankingService.js';

function normalizeProfessionalProfile(profileDoc) {
  const p = profileDoc ? (typeof profileDoc.toObject === 'function' ? profileDoc.toObject() : profileDoc) : {};
  return {
    ...p,
    full_name: p.full_name || '',
    website: p.website || '',
    company_name: p.company_name || '',
    certificates: Array.isArray(p.certificates) ? p.certificates : [],
    phone: p.phone || '',
    location: p.location || '',
    target_neighborhoods: p.target_neighborhoods || '',
    experience: p.experience || '',
    license_number: p.license_number || '',
    social_media: p.social_media || '',
    transaction_volume: p.transaction_volume || '',
    avg_sale_price: p.avg_sale_price || '',
    response_time: p.response_time || '',
    availability: p.availability || '',
    support_level: p.support_level || '',
    negotiation_style: p.negotiation_style || '',
    sales_approach: p.sales_approach || '',
    energy_style: p.energy_style || '',
    personality_tag: p.personality_tag || '',
    awards: p.awards || '',
    specializations: Array.isArray(p.specializations) ? p.specializations : [],
    communication_channels: Array.isArray(p.communication_channels) ? p.communication_channels : [],
    preferred_clients: Array.isArray(p.preferred_clients) ? p.preferred_clients : [],
    calendly_link: p.calendly_link || '',
    bio: p.bio || '',
  };
}

const ICP_ROLE_FIELDS = Object.freeze({
  agent: ['client_types', 'price_range', 'property_types', 'service_areas', 'timeline_preference'],
  mortgage_broker: ['loan_types', 'credit_range_preference', 'income_preference', 'loan_size_range'],
  lawyer: ['transaction_types', 'preferred_property_values', 'service_areas'],
});
const ALL_ICP_FIELDS = Object.freeze(
  Array.from(new Set(Object.values(ICP_ROLE_FIELDS).flat()))
);
const ICP_RESCORING_BULK_CHUNK_SIZE = 250;

function roleScopedIcpPayload(professionalType, input = {}) {
  const allowed = ICP_ROLE_FIELDS[professionalType] || [];
  const scoped = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) scoped[key] = input[key];
  }
  return { ...scoped, is_configured: true };
}

function roleExcludedUnsetMap(professionalType) {
  const allowed = new Set(ICP_ROLE_FIELDS[professionalType] || []);
  const unset = {};
  for (const key of ALL_ICP_FIELDS) {
    if (!allowed.has(key)) unset[key] = 1;
  }
  return unset;
}

async function runBulkWriteInChunks(model, operations, chunkSize = ICP_RESCORING_BULK_CHUNK_SIZE) {
  if (!Array.isArray(operations) || operations.length === 0) return;
  for (let i = 0; i < operations.length; i += chunkSize) {
    const chunk = operations.slice(i, i + chunkSize);
    // unordered keeps throughput higher and isolates single-op failures
    await model.bulkWrite(chunk, { ordered: false });
  }
}

/** Public ICP shape for API (no internal linkage fields). */
function toIdealClientProfileResponse(icpDoc) {
  if (!icpDoc) return { is_configured: false };
  const src = typeof icpDoc.toObject === 'function' ? icpDoc.toObject() : icpDoc;
  const {
    user_id,
    professional_profile_id,
    professional_type,
    is_active,
    _id,
    __v,
    createdAt,
    updatedAt,
    ...rest
  } = src;
  return rest;
}

export const getMyProfessionalProfile = async (req, res, next) => {
  try {
    const user = req.user;
    const profile = await ProfessionalProfile.findOne({ user_id: user._id });
    res.json({
      success: true,
      user: {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        profile_image: user.profile_image || null,
        cover_image: user.cover_image || null,
      },
      professionalProfile: normalizeProfessionalProfile(profile),
    });
  } catch (error) {
    next(error);
  }
};
export const upsertProfessionalProfile = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const body = req.body || {};
    const {
      phone,
      location,
      target_neighborhoods,
      experience,
      license_number,
      social_media,
      company_name,
      transaction_volume,
      avg_sale_price,
      response_time,
      availability,
      support_level,
      negotiation_style,
      sales_approach,
      energy_style,
      personality_tag,
      awards,
      specializations,
      communication_channels,
      preferred_clients,
      calendly_link,
      bio,
      website,
      certificates,
      full_name,
    } = body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let userSaved = false;
    if (Object.prototype.hasOwnProperty.call(body, 'first_name')) {
      const s = body.first_name == null ? '' : String(body.first_name).trim();
      if (!s) {
        return res.status(400).json({ success: false, message: 'first_name cannot be empty' });
      }
      user.first_name = s;
      userSaved = true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'last_name')) {
      const s = body.last_name == null ? '' : String(body.last_name).trim();
      if (!s) {
        return res.status(400).json({ success: false, message: 'last_name cannot be empty' });
      }
      user.last_name = s;
      userSaved = true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'profile_image')) {
      const v = body.profile_image;
      user.profile_image =
        v != null && String(v).trim() !== '' ? String(v).trim().slice(0, 2048) : null;
      userSaved = true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'cover_image')) {
      const v = body.cover_image;
      user.cover_image =
        v != null && String(v).trim() !== '' ? String(v).trim().slice(0, 2048) : null;
      userSaved = true;
    }
    if (userSaved) {
      await user.save();
    }

    const trimmedDisplayOverride =
      full_name != null && String(full_name).trim() !== '' ? String(full_name).trim() : null;
    const displayFullName = trimmedDisplayOverride ?? `${user.first_name} ${user.last_name}`.trim();
    const update = {};
    /** Single source of truth: `User.role` (not the request body). */
    if (isValidProfessionalType(req.user.role)) {
      update.professional_type = req.user.role;
    }
    if (phone !== undefined) update.phone = phone;
    if (location !== undefined) update.location = location;
    if (target_neighborhoods !== undefined) update.target_neighborhoods = target_neighborhoods;
    if (experience !== undefined) update.experience = experience;
    if (license_number !== undefined) update.license_number = license_number;
    if (social_media !== undefined) update.social_media = social_media;
    if (company_name !== undefined) update.company_name = company_name;
    if (transaction_volume !== undefined) update.transaction_volume = transaction_volume;
    if (avg_sale_price !== undefined) update.avg_sale_price = avg_sale_price;
    if (response_time !== undefined) update.response_time = response_time;
    if (availability !== undefined) update.availability = availability;
    if (support_level !== undefined) update.support_level = support_level;
    if (negotiation_style !== undefined) update.negotiation_style = negotiation_style;
    if (sales_approach !== undefined) update.sales_approach = sales_approach;
    if (energy_style !== undefined) update.energy_style = energy_style;
    if (personality_tag !== undefined) update.personality_tag = personality_tag;
    if (awards !== undefined) update.awards = awards;
    if (specializations !== undefined) update.specializations = specializations;
    if (communication_channels !== undefined) update.communication_channels = communication_channels;
    if (preferred_clients !== undefined) update.preferred_clients = preferred_clients;

    // Single Calendly URL for all users.
    if (calendly_link !== undefined) update.calendly_link = calendly_link;
    if (bio !== undefined) update.bio = bio;
    if (website !== undefined) update.website = website;
    if (certificates !== undefined) update.certificates = certificates;
    update.full_name = displayFullName;
    const profile = await ProfessionalProfile.findOneAndUpdate(
      { user_id: userId },
      { $set: update },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    );
    try {
      const setup = evaluateProfessionalProfileSetup(user, profile);
      if (setup.is_complete) {
        await awardInviterMilestoneForUser(userId, 'pro_profile_complete', String(profile._id));
      }
    } catch {
      /* non-fatal */
    }
    if (
      calendly_link !== undefined
    ) {
      try {
        await refreshCalendlySlugMismatchForUser(userId);
      } catch {
        /* non-fatal */
      }
    }
    res.json({
      success: true,
      message: 'Professional profile saved successfully',
      user: {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        profile_image: user.profile_image || null,
        cover_image: user.cover_image || null,
      },
      profile: normalizeProfessionalProfile(profile),
    });
  } catch (error) {
    next(error);
  }
};

export const getIdealClientProfile = async (req, res, next) => {
  try {
    const profile = await ProfessionalProfile.findOne({ user_id: req.user._id })
      .select('active_icp_profile_id')
      .lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Professional profile not found' });
    }
    let icp = null;
    if (profile.active_icp_profile_id) {
      icp = await IcpProfile.findById(profile.active_icp_profile_id)
        .select('-user_id -professional_profile_id -professional_type -is_active')
        .lean();
    }
    return res.json({
      success: true,
      ideal_client_profile: toIdealClientProfileResponse(icp),
      active_icp_profile_id: profile.active_icp_profile_id || null,
    });
  } catch (error) {
    return next(error);
  }
};

export const saveIdealClientProfile = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const profile = await ProfessionalProfile.findOne({ user_id: userId });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Professional profile not found' });
    }
    const icp = roleScopedIcpPayload(profile.professional_type, req.body);
    const roleUnset = roleExcludedUnsetMap(profile.professional_type);
    let icpProfile = null;
    if (profile.active_icp_profile_id) {
      icpProfile = await IcpProfile.findByIdAndUpdate(
        profile.active_icp_profile_id,
        {
          $set: {
            ...icp,
            user_id: userId,
            professional_profile_id: profile._id,
            professional_type: profile.professional_type,
            is_active: true,
          },
          $unset: roleUnset,
        },
        { returnDocument: 'after' }
      );
    }
    if (!icpProfile) {
      icpProfile = await IcpProfile.create({
        ...icp,
        user_id: userId,
        professional_profile_id: profile._id,
        professional_type: profile.professional_type,
        is_active: true,
      });
    }
    profile.active_icp_profile_id = icpProfile._id;
    if (!Array.isArray(profile.icp_profile_ids)) profile.icp_profile_ids = [];
    if (!profile.icp_profile_ids.some((id) => String(id) === String(icpProfile._id))) {
      profile.icp_profile_ids.push(icpProfile._id);
    }
    await profile.save();

    const leadMatches = await LeadMatch.find({
      user_id: userId,
      lead_profile_id: { $ne: null },
    })
      .select('_id lead_profile_id createdAt')
      .sort({ createdAt: 1 })
      .lean();

    const firstMatchIdByProfile = new Map();
    for (const m of leadMatches) {
      const pid = String(m.lead_profile_id);
      if (!firstMatchIdByProfile.has(pid)) firstMatchIdByProfile.set(pid, String(m._id));
    }

    const uniqueProfileIds = Array.from(
      new Set(
        leadMatches
          .map((m) => (m.lead_profile_id ? String(m.lead_profile_id) : ''))
          .filter(Boolean)
      )
    );
    const leadProfiles = uniqueProfileIds.length
      ? await LeadProfile.find({ _id: { $in: uniqueProfileIds } }).lean()
      : [];
    const leadProfileById = new Map(
      leadProfiles.map((doc) => [String(doc._id), doc])
    );

    const bulkOps = [];
    for (const lm of leadMatches) {
      const pid = String(lm.lead_profile_id || '');
      if (!pid) continue;
      const leadProfile = leadProfileById.get(pid);
      if (!leadProfile) continue;

      const reusedExisting = firstMatchIdByProfile.get(pid) !== String(lm._id);
      const fit = scoreLeadAgainstIcp(leadProfile, icpProfile, { reusedExisting });
      if (!fit) continue;

      bulkOps.push({
        updateOne: {
          filter: { _id: lm._id },
          update: {
            $set: {
              icp_fit: {
                fit_score: fit.fit_score,
                fit_tier: fit.fit_tier,
                matched_factors: fit.matched_factors,
                missing_factors: fit.missing_factors,
              },
            },
          },
        },
      });
    }

    await runBulkWriteInChunks(LeadMatch, bulkOps);
    const rescored = bulkOps.length;

    return res.json({
      success: true,
      message: 'Ideal client profile saved',
      ideal_client_profile: toIdealClientProfileResponse(icpProfile),
      active_icp_profile_id: icpProfile._id,
      leads_rescored: rescored,
    });
  } catch (error) {
    return next(error);
  }
};

export const listProfessionalsByRole = async (req, res, next) => {
  try {
    const roleRaw = String(req.query.role || '').trim().toLowerCase();
    const role = roleRaw && PROFESSIONAL_TYPE_VALUES.includes(roleRaw) ? roleRaw : null;
    const fetchAll = String(req.query.all || '').trim().toLowerCase() === 'true';
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '12'), 10) || 12, 1), 100);
    const search = String(req.query.search || '').trim();

    const currentUserId = req.user?._id ? String(req.user._id) : null;
    const userFilter = role
      ? { role }
      : { role: { $in: PROFESSIONAL_TYPE_VALUES } };

    if (currentUserId) {
      userFilter._id = { $ne: req.user._id };
    }

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      userFilter.$or = [{ first_name: re }, { last_name: re }, { email: re }];
    }

    const total = await User.countDocuments(userFilter);
    const query = User.find(userFilter)
      .select('first_name last_name email role profile_image cover_image createdAt updatedAt')
      .sort({ createdAt: -1 });

    if (!fetchAll) {
      query.skip((page - 1) * limit).limit(limit);
    }

    const users = await query.lean();

    const userIds = users.map((u) => u._id);
    const profiles = userIds.length
      ? await ProfessionalProfile.find({ user_id: { $in: userIds } })
          .select('user_id professional_type full_name company_name phone location website calendly_link')
          .lean()
      : [];
    const profileByUser = new Map(profiles.map((p) => [String(p.user_id), p]));
    const leadStatsRows = userIds.length
      ? await LeadMatch.aggregate([
          { $match: { user_id: { $in: userIds } } },
          {
            $group: {
              _id: '$user_id',
              total_leads: { $sum: 1 },
              total_deals: {
                $sum: {
                  $cond: [{ $eq: ['$match_status', 'converted'] }, 1, 0],
                },
              },
            },
          },
        ])
      : [];
    const leadStatsByUser = new Map(
      leadStatsRows.map((row) => [
        String(row._id),
        {
          total_leads: Number(row.total_leads || 0),
          total_deals: Number(row.total_deals || 0),
        },
      ])
    );

    const items = users.map((u) => {
      const p = profileByUser.get(String(u._id)) || {};
      const stats = leadStatsByUser.get(String(u._id)) || { total_leads: 0, total_deals: 0 };
      const fullName =
        String(p.full_name || '').trim() ||
        [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
        '';
      return {
        id: String(u._id),
        role: u.role,
        email: u.email || '',
        first_name: u.first_name || '',
        last_name: u.last_name || '',
        full_name: fullName,
        profile_image: u.profile_image || null,
        company_name: p.company_name || '',
        phone: p.phone || '',
        location: p.location || '',
        website: p.website || '',
        calendly_link: p.calendly_link || '',
        professional_type: p.professional_type || u.role || null,
        total_leads: stats.total_leads,
        total_deals: stats.total_deals,
        created_at: u.createdAt || null,
      };
    });

    return res.json({
      success: true,
      items,
      pagination: {
        page,
        limit: fetchAll ? total : limit,
        total,
        total_pages: fetchAll ? 1 : Math.max(Math.ceil(total / limit), 1),
        has_prev_page: fetchAll ? false : page > 1,
        has_next_page: fetchAll ? false : page * limit < total,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getProfessionalById = async (req, res, next) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing professional id' });
    }

    const user = await User.findById(userId)
      .select('first_name last_name email role profile_image cover_image createdAt updatedAt')
      .lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'Professional not found' });
    }

    const profile = await ProfessionalProfile.findOne({ user_id: user._id })
      .select(
        'professional_type full_name website company_name certificates phone location target_neighborhoods experience license_number social_media transaction_volume avg_sale_price avg_home_price response_time availability support_level negotiation_style sales_approach energy_style personality_tag awards specializations communication_channels preferred_clients calendly_link bio languages_spoken working_style_structured experience_level',
      )
      .lean();

    const fullName =
      String(profile?.full_name || '').trim() ||
      [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
      '';
    const leadStats = await LeadMatch.aggregate([
      { $match: { user_id: user._id } },
      {
        $group: {
          _id: '$user_id',
          total_leads: { $sum: 1 },
          total_deals: {
            $sum: {
              $cond: [{ $eq: ['$match_status', 'converted'] }, 1, 0],
            },
          },
        },
      },
    ]);
    const stats = leadStats?.[0] || {};
    const clientProfile =
      req.user?.role === 'client'
        ? await ClientProfile.findOne({ user_id: req.user._id }).lean()
        : null;
    const aiMatch = clientProfile && profile ? calculateAiCompatibilityScore(clientProfile, profile) : {};

    return res.json({
      success: true,
      professional: {
        id: String(user._id),
        role: user.role,
        email: user.email || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        full_name: fullName,
        profile_image: user.profile_image || null,
        cover_image: user.cover_image || null,
        professional_type: profile?.professional_type || user.role || null,
        company_name: profile?.company_name || '',
        phone: profile?.phone || '',
        location: profile?.location || '',
        website: profile?.website || '',
        calendly_link: profile?.calendly_link || '',
        bio: profile?.bio || '',
        certificates: Array.isArray(profile?.certificates) ? profile.certificates : [],
        target_neighborhoods: profile?.target_neighborhoods || '',
        experience: profile?.experience || '',
        license_number: profile?.license_number || '',
        social_media: profile?.social_media || '',
        transaction_volume: profile?.transaction_volume || '',
        avg_sale_price: profile?.avg_sale_price || '',
        response_time: profile?.response_time || '',
        availability: profile?.availability || '',
        support_level: profile?.support_level || '',
        negotiation_style: profile?.negotiation_style || '',
        sales_approach: profile?.sales_approach || '',
        energy_style: profile?.energy_style || '',
        personality_tag: profile?.personality_tag || '',
        awards: profile?.awards || '',
        specializations: Array.isArray(profile?.specializations) ? profile.specializations : [],
        communication_channels: Array.isArray(profile?.communication_channels) ? profile.communication_channels : [],
        preferred_clients: Array.isArray(profile?.preferred_clients) ? profile.preferred_clients : [],
        languages_spoken: Array.isArray(profile?.languages_spoken) ? profile.languages_spoken : [],
        working_style_structured: profile?.working_style_structured || '',
        experience_level: profile?.experience_level || '',
        total_leads: Number(stats.total_leads || 0),
        total_deals: Number(stats.total_deals || 0),
        created_at: user.createdAt || null,
        updated_at: user.updatedAt || null,
        ...aiMatch,
      },
    });
  } catch (error) {
    return next(error);
  }
};
