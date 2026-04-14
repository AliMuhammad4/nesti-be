import ProfessionalProfile from '../models/ProfessionalProfile.js';
import User from '../models/User.js';
import { isValidProfessionalType } from '../constants/roles.js';
import { refreshCalendlySlugMismatchForUser } from '../services/calendly/calendlyAlignmentService.js';
import { scoreLeadAgainstIcp } from '../services/lead/icpScoringService.js';
import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import IcpProfile from '../models/IcpProfile.js';

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
        { new: true }
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

    let rescored = 0;
    for (const lm of leadMatches) {
      const leadProfile = await LeadProfile.findById(lm.lead_profile_id).lean();
      if (!leadProfile) continue;
      const pid = String(lm.lead_profile_id);
      const reusedExisting = firstMatchIdByProfile.get(pid) !== String(lm._id);
      const fit = scoreLeadAgainstIcp(leadProfile, icpProfile, { reusedExisting });
      if (!fit) continue;
      await LeadMatch.findByIdAndUpdate(lm._id, {
        $set: {
          icp_fit: {
            fit_score: fit.fit_score,
            fit_tier: fit.fit_tier,
            matched_factors: fit.matched_factors,
            missing_factors: fit.missing_factors,
          },
        },
      });
      rescored += 1;
    }

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
