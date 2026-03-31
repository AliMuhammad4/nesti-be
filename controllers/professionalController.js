import ProfessionalProfile from '../models/ProfessionalProfile.js';
import User from '../models/User.js';
import { isValidProfessionalType } from '../constants/roles.js';
import { refreshCalendlySlugMismatchForUser } from '../services/calendly/calendlyAlignmentService.js';

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

