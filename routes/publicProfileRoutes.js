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
import { validateBody } from '../middleware/validate.js';
import { submitPublicFeedbackSchema, submitPublicLeadSchema } from '../schemas/publicProfileSchemas.js';
import { publicLandingChatConfigService } from '../services/admin/adminLandingChatService.js';
import { handleLandingChatTurn, loadLandingChatSession } from '../services/chat/nestiLanding/landingChatTurnService.js';
import { enterpriseInquiryCreateSchema } from '../schemas/opsSchemas.js';
import { createDirectAdminInquiry } from '../services/admin/directInquiryService.js';
import { publicChatSessionLimiter } from '../middleware/rateLimit.js';

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
      sessionId: body.id || body.session_id,
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

router.post('/direct-inquiry', validateBody(enterpriseInquiryCreateSchema), async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const message = String(body.message || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!message) return res.status(400).json({ success: false, message: 'A message is required' });
    const inquiry = await createDirectAdminInquiry({
      ...body,
      email,
      full_name: body.full_name,
      interest_role: body.interest_role || '',
    });
    if (!inquiry) return res.status(400).json({ success: false, message: 'Could not save that request' });
    res.json({ success: true, message: 'Inquiry received', id: String(inquiry._id) });
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
router.post('/professionals/:slug/lead', optionalAuth, validateBody(submitPublicLeadSchema), submitPublicLead);
router.post('/professionals/:slug/feedback', validateBody(submitPublicFeedbackSchema), submitPublicFeedback);

router.post('/professionals/:slug/analytics', optionalAuth, trackProfileView);

router.post('/slug/check', optionalAuth, checkSlugAvailability);

export default router;
