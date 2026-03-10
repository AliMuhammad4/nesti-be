import ProfessionalProfile from '../models/ProfessionalProfile.js';
import User from '../models/User.js';

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
    const {
      professional_type,
      phone,
      location,
      target_neighborhoods,
      experience,
      calendly_link,
      bio,
      website,
      certificates,
      first_name,
      last_name,
      full_name,
    } = req.body;

    // 1) Update user's name in the core User collection if provided
    if (first_name || last_name) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      if (first_name) user.first_name = first_name;
      if (last_name) user.last_name = last_name;
      await user.save();
    }

    // 2) Compute display full_name
    let displayFullName = full_name;
    if (!displayFullName) {
      // Refresh user to ensure we have latest names (in case we just updated them)
      const freshUser = await User.findById(userId);
      displayFullName = `${freshUser.first_name} ${freshUser.last_name}`;
    }

    // 3) Build update object only with fields that were actually sent
    const update = {};
    if (professional_type !== undefined) update.professional_type = professional_type;
    if (phone !== undefined) update.phone = phone;
    if (location !== undefined) update.location = location;
    if (target_neighborhoods !== undefined) update.target_neighborhoods = target_neighborhoods;
    if (experience !== undefined) update.experience = experience;
    if (calendly_link !== undefined) update.calendly_link = calendly_link;
    if (bio !== undefined) update.bio = bio;
    if (website !== undefined) update.website = website;
    if (certificates !== undefined) update.certificates = certificates;
    update.full_name = displayFullName;

    const profile = await ProfessionalProfile.findOneAndUpdate(
      { user_id: userId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json({
      success: true,
      message: 'Professional profile saved successfully',
      profile,
    });
  } catch (error) {
    next(error);
  }
};

