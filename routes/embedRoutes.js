import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import crypto from 'crypto';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';

const generateEmbedToken = async (req, res, next) => {
  try {
    const token = crypto.randomBytes(24).toString('hex');
    const embed = await ChatbotEmbedUrl.create({
      user_id: req.user._id,
      token,
      allowed_domains: req.body.allowed_domains || [],
      widget_settings: req.body.widget_settings || {},
    });
    res.json({ success: true, token: embed.token, id: embed._id, message: 'Embed token generated' });
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
    res.json({ success: true, isValid: true, userId: embed.user_id });
  } catch (error) {
    next(error);
  }
};

const updateEmbed = async (req, res, next) => {
  try {
    const embed = await ChatbotEmbedUrl.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      { $set: req.body },
      { new: true }
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

router.post('/generate', protect, generateEmbedToken);
router.get('/list', protect, listEmbeds);
router.get('/resolve/:token', resolveEmbed);
router.patch('/:id', protect, updateEmbed);
router.delete('/:id', protect, deleteEmbed);

export default router;
