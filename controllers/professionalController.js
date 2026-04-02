import ProfessionalProfile from '../models/ProfessionalProfile.js';
import User from '../models/User.js';
import { isValidProfessionalType } from '../constants/roles.js';
import { refreshCalendlySlugMismatchForUser } from '../services/calendly/calendlyAlignmentService.js';
import { scoreLeadAgainstIcp } from '../services/lead/icpScoringService.js';
import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import IcpProfile from '../models/IcpProfile.js';

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
      professionalProfile: profile,
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
      calendly_link,
      mortgage_calendly_link_hot,
      mortgage_calendly_link_warm,
      mortgage_calendly_link_early,
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
    if (calendly_link !== undefined) update.calendly_link = calendly_link;
    if (mortgage_calendly_link_hot !== undefined) update.mortgage_calendly_link_hot = mortgage_calendly_link_hot;
    if (mortgage_calendly_link_warm !== undefined) update.mortgage_calendly_link_warm = mortgage_calendly_link_warm;
    if (mortgage_calendly_link_early !== undefined) update.mortgage_calendly_link_early = mortgage_calendly_link_early;
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
      calendly_link !== undefined ||
      mortgage_calendly_link_hot !== undefined ||
      mortgage_calendly_link_warm !== undefined ||
      mortgage_calendly_link_early !== undefined
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
      profile,
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
