import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import crypto from 'crypto';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import { PROFESSIONAL_TYPE } from '../constants/roles.js';
import { validateWidgetRoleAgainstProfile } from '../utils/embedWidgetRole.js';
import { embedGenerateBodySchema, embedPatchBodySchema } from '../schemas/chatSchemas.js';

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
    res.json({
      success: true,
      isValid: true,
      userId: embed.user_id,
      widget_role: embed.widget_role ?? null,
      widget_settings: embed.widget_settings || {},
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

router.post('/generate', protect, validateBody(embedGenerateBodySchema), generateEmbedToken);
router.get('/list', protect, listEmbeds);
router.get('/resolve/:token', resolveEmbed);
router.patch('/:id', protect, validateBody(embedPatchBodySchema), updateEmbed);
router.delete('/:id', protect, deleteEmbed);

export default router;
