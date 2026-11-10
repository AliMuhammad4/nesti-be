import express from 'express';
import {
  getPublicProfileBySlug,
  getPublicProfileShellBySlug,
  getPublishedStorefrontBySlug,
  getPublicProfessionalNetwork,
  getPublicProfessionalsList,
  getSellerProperties,
  trackProfileView,
  checkSlugAvailability,
  submitPublicLead,
  submitPublicFeedback,
  getApprovedPublicFeedback,
} from '../controllers/publicProfileController.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import User from '../models/User.js';
import { validateBody } from '../middleware/validate.js';
import { submitPublicFeedbackSchema, submitPublicLeadSchema } from '../schemas/publicProfileSchemas.js';
import { publicLandingChatConfigService } from '../services/admin/adminLandingChatService.js';
import { handleLandingChatTurn, loadLandingChatSession } from '../services/chat/nestiLanding/landingChatTurnService.js';
import { enterpriseInquiryCreateSchema } from '../schemas/opsSchemas.js';
import { createDirectAdminInquiry, unsubscribeNewsletterAddress } from '../services/admin/directInquiryService.js';
import { optOutOfNurtureByToken } from '../services/nurture/nurtureUnsubscribe.js';
import { publicChatSessionLimiter, publicLeadSubmitLimiter } from '../middleware/rateLimit.js';
import { uploadPropertyImages } from '../middleware/uploadPropertyImages.js';
import { postPublicProfilePropertyImagesUpload } from '../controllers/chatPropertyImageController.js';

const router = express.Router();

router.get('/landing-chat/config', async (_req, res, next) => {
  try {
    const result = await publicLandingChatConfigService();
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

router.post('/landing-chat/session', publicChatSessionLimiter, async (req, res, next) => {
  try {
    const result = await loadLandingChatSession({
      embedToken: req.body?.embedToken || req.body?.embed_token,
      sessionId: req.body?.session_id || req.body?.id,
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

router.post('/landing-chat/message', async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await handleLandingChatTurn({
      message: body.message,
      embedToken: body.embedToken || body.embed_token,
      sessionId: body.session_id || body.id,
      visitorId: body.visitorId || body.visitor_id,
      clientIp: req.ip,
      opening: Boolean(body.opening),
      formContact: body.formContact || body.form_contact || {
        name: body.name,
        email: body.email,
        phone: body.phone,
        audience_role: body.audience_role,
      },
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

async function isProfessionalEmbed(embedToken) {
  const token = String(embedToken || '').trim();
  if (!token) return false;
  const embed = await ChatbotEmbedUrl.findOne({ token }).select('user_id').lean();
  if (!embed?.user_id) return false;
  const owner = await User.findById(embed.user_id).select('role').lean();
  return Boolean(owner) && owner.role !== 'admin';
}

router.post('/direct-inquiry', validateBody(enterpriseInquiryCreateSchema), async (req, res, next) => {
  try {
    const { embed_token: embedToken, ...body } = req.body || {};
    if (await isProfessionalEmbed(embedToken)) {
      return res.json({ success: true, message: 'Inquiry received', admin_copy: false });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const message = String(body.message || '').trim();
    const newsletter = String(body.inquiry_topic || body.source || '').toLowerCase() === 'newsletter';
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!newsletter && !message) {
      return res.status(400).json({ success: false, message: 'A message is required' });
    }
    const inquiry = await createDirectAdminInquiry({
      ...body,
      email,
      full_name: body.full_name,
      interest_role: body.interest_role || '',
      message: message || (newsletter ? 'Newsletter signup' : ''),
    });
    if (!inquiry) return res.status(400).json({ success: false, message: 'Could not save that request' });
    res.json({
      success: true,
      message: newsletter ? 'You are on the list' : 'Inquiry received',
      id: String(inquiry._id),
      ...(newsletter && inquiry.unsubscribe_url
        ? { unsubscribe_url: inquiry.unsubscribe_url }
        : {}),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/newsletter/unsubscribe', async (req, res, next) => {
  try {
    const removed = await unsubscribeNewsletterAddress(req.query.token);
    if (!removed) return res.status(404).json({ success: false, message: 'That unsubscribe link is not valid' });
    res.json({ success: true, message: 'You have been removed from The Ravinna Report' });
  } catch (error) {
    next(error);
  }
});

router.get('/followups/unsubscribe', async (req, res, next) => {
  try {
    const removed = await optOutOfNurtureByToken(req.query.token);
    if (!removed) return res.status(404).json({ success: false, message: 'That unsubscribe link is not valid' });
    res.json({ success: true, message: 'You will not receive more follow-up emails from this professional.' });
  } catch (error) {
    next(error);
  }
});

router.get('/professionals', getPublicProfessionalsList);
router.get('/professional-network', getPublicProfessionalNetwork);
router.get('/professionals/:slug/properties', getSellerProperties);
router.get('/professionals/:slug/shell', getPublicProfileShellBySlug);
router.get('/professionals/:slug/storefront', getPublishedStorefrontBySlug);
router.get('/professionals/:slug/feedback', getApprovedPublicFeedback);
router.get('/professionals/:slug', getPublicProfileBySlug);
router.post('/professionals/:slug/property-images', publicLeadSubmitLimiter, uploadPropertyImages.array('images', 8), postPublicProfilePropertyImagesUpload);
router.post('/professionals/:slug/lead', publicLeadSubmitLimiter, optionalAuth, validateBody(submitPublicLeadSchema), submitPublicLead);
router.post('/professionals/:slug/feedback', validateBody(submitPublicFeedbackSchema), submitPublicFeedback);
router.post('/professionals/:slug/analytics', optionalAuth, trackProfileView);
router.post('/slug/check', optionalAuth, checkSlugAvailability);

export default router;
