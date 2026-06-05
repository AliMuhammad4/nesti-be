import express from 'express';
const router = express.Router();
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import crypto from 'crypto';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import User from '../models/User.js';
import { PROFESSIONAL_TYPE, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { validateWidgetRoleAgainstProfile } from '../utils/embedWidgetRole.js';
import { embedGenerateBodySchema, embedPatchBodySchema } from '../schemas/chatSchemas.js';
import { FEATURES } from '../services/billing/entitlements.js';

const generateEmbedToken = async (req, res, next) => {
  try {
    const profile = await ProfessionalProfile.findOne({ user_id: req.user._id }).lean();
    const raw =
      req.body.widget_role != null && String(req.body.widget_role).trim() !== ''
        ? String(req.body.widget_role).trim()
        : profile?.professional_type || PROFESSIONAL_TYPE.AGENT;

    const genCheck = validateWidgetRoleAgainstProfile(raw, profile);
    if (!genCheck.ok) {
      return res.status(400).json({ success: false, message: genCheck.message });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const embed = await ChatbotEmbedUrl.create({
      user_id: req.user._id,
      token,
      widget_role: raw,
      allowed_domains: req.body.allowed_domains || [],
      widget_settings: req.body.widget_settings || {},
    });
    res.json({
      success: true,
      token: embed.token,
      id: embed._id,
      widget_role: embed.widget_role,
      message: 'Embed token generated',
    });
  } catch (error) {
    next(error);
  }
};

const listEmbeds = async (req, res, next) => {
  try {
    const embeds = await ChatbotEmbedUrl.find({ user_id: req.user._id });
    res.json({ success: true, embeds });
  } catch (error) {
    next(error);
  }
};

const resolveEmbed = async (req, res, next) => {
  try {
    const embed = await ChatbotEmbedUrl.findOne({ token: req.params.token });
    if (!embed) return res.status(404).json({ success: false, message: 'Invalid embed token' });

    const [user, prof] = await Promise.all([
      User.findById(embed.user_id).select('first_name last_name profile_image').lean(),
      ProfessionalProfile.findOne({ user_id: embed.user_id }).select('full_name professional_type').lean(),
    ]);

    const profileImage =
      typeof user?.profile_image === 'string' && user.profile_image.trim() ? user.profile_image.trim() : null;
    const hostDisplayName =
      (typeof prof?.full_name === 'string' && prof.full_name.trim()) ||
      [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
      null;

    const resolvedWidgetRole =
      embed.widget_role ||
      (prof?.professional_type && PROFESSIONAL_TYPE_VALUES.includes(prof.professional_type)
        ? prof.professional_type
        : null);

    res.json({
      success: true,
      isValid: true,
      userId: embed.user_id,
      widget_role: resolvedWidgetRole,
      widget_settings: embed.widget_settings || {},
      profile_image: profileImage,
      host_display_name: hostDisplayName,
    });
  } catch (error) {
    next(error);
  }
};

const updateEmbed = async (req, res, next) => {
  try {
    const body = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(body, 'widget_role')) {
      const wr = body.widget_role;
      if (wr != null && String(wr).trim() !== '') {
        const v = String(wr).trim();
        const profile = await ProfessionalProfile.findOne({ user_id: req.user._id }).lean();
        const patchCheck = validateWidgetRoleAgainstProfile(v, profile);
        if (!patchCheck.ok) {
          return res.status(400).json({ success: false, message: patchCheck.message });
        }
        body.widget_role = v;
      } else {
        delete body.widget_role;
      }
    }

    const embed = await ChatbotEmbedUrl.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      { $set: body },
      { returnDocument: 'after' }
    );
    if (!embed) return res.status(404).json({ success: false, message: 'Embed not found' });
    res.json({ success: true, embed });
  } catch (error) {
    next(error);
  }
};

const deleteEmbed = async (req, res, next) => {
  try {
    await ChatbotEmbedUrl.findOneAndDelete({ _id: req.params.id, user_id: req.user._id });
    res.json({ success: true, message: 'Embed deleted' });
  } catch (error) {
    next(error);
  }
};

router.post(
  '/generate',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.CHATBOT_BASIC),
  validateBody(embedGenerateBodySchema),
  generateEmbedToken
);
router.get('/list', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CHATBOT_BASIC), listEmbeds);
router.get('/resolve/:token', resolveEmbed);
router.patch('/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CHATBOT_BASIC), validateBody(embedPatchBodySchema), updateEmbed);
router.delete('/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CHATBOT_BASIC), deleteEmbed);

export default router;
