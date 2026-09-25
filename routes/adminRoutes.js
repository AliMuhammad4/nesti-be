import express from 'express';
import { protect, ensureAdmin, requirePermission } from '../middleware/authMiddleware.js';
import { validateBody, validateQuery, validateActingUserId } from '../middleware/validate.js';
import { ADMIN_PERMISSION } from '../constants/adminPermissions.js';
import {
  adminSuspendUserSchema,
  adminPatchProfessionalSchema,
  adminPatchClientSchema,
  adminPatchLeadSchema,
  adminPatchPropertySchema,
  adminPatchSubscriptionSchema,
  adminPatchReferralSchema,
  adminRejectVerificationSchema,
  adminActingUserIdSchema,
  adminCalendlyCancelBookingBodySchema,
} from '../schemas/adminSchemas.js';
import {
  generateStorefrontDraftSchema,
  publishStorefrontSchema,
  saveStorefrontDraftSchema,
} from '../schemas/publicProfileSchemas.js';
import {
  referralPostBodySchema,
  referralPatchBodySchema,
  nurtureDraftBodySchema,
  nurtureRefineBodySchema,
  nurturePreviewBodySchema,
  nurtureSendBodySchema,
} from '../schemas/chatRouteSchemas.js';
import { leadConversationMessageSchema } from '../schemas/leadSchemas.js';
import { embedGenerateBodySchema, embedPatchBodySchema } from '../schemas/chatSchemas.js';
import { objectId } from '../schemas/common.js';
import { runProfileUpload } from '../middleware/uploadProfileImage.js';
import {
  getAdminOverview,
  getAdminAnalytics,
  suspendAdminUser,
  unsuspendAdminUser,
  listAdminProfessionals,
  getAdminProfessional,
  patchAdminProfessional,
  getAdminProfessionalStorefront,
  getAdminProfessionalStorefrontDraft,
  getAdminProfessionalStorefrontProperties,
  saveAdminProfessionalStorefrontDraft,
  publishAdminProfessionalStorefront,
  generateAdminProfessionalStorefrontDraft,
  uploadAdminProfessionalStorefrontImage,
  listAdminProfessionalChatbotEmbeds,
  generateAdminProfessionalChatbotEmbed,
  patchAdminProfessionalChatbotEmbed,
  deleteAdminProfessionalChatbotEmbed,
  listAdminClients,
  getAdminClient,
  patchAdminClient,
  listAdminLeads,
  getAdminLead,
  patchAdminLead,
  deleteAdminLead,
  getAdminLeadConversation,
  getAdminLeadPropertyMatches,
  getAdminLeadInquiredProperty,
  analyzeAdminLeadInsights,
  adminPostLeadConversationMessage,
  adminNurtureDraft,
  adminNurtureRefine,
  adminNurturePreview,
  adminNurtureSend,
  adminNurtureLogs,
  adminListLeadReferrals,
  adminCreateLeadReferral,
  adminPatchReferralAsProfessional,
  adminProcessReferralAsProfessional,
  adminReferralLeadDetails,
  adminCancelLeadCalendlyBooking,
  adminStartVoiceCall,
  adminStopVoiceCall,
  adminListVoiceCalls,
  adminListCallRecordings,
  adminRecordingPlayback,
  adminCallTranscript,
  adminListVoiceSuggestions,
  adminDecideVoiceSuggestion,
  adminListSalesPipeline,
  listAdminProperties,
  getAdminProperty,
  patchAdminProperty,
  deleteAdminProperty,
  listAdminSubscriptions,
  getAdminSubscription,
  patchAdminSubscription,
  listAdminReferrals,
  getAdminReferral,
  patchAdminReferral,
  listAdminVerifications,
  getAdminVerification,
  getAdminVerificationDocument,
  approveAdminVerification,
  rejectAdminVerification,
} from '../controllers/adminController.js';

const router = express.Router();
const P = ADMIN_PERMISSION;

router.use(protect, ensureAdmin);

router.get('/overview', requirePermission(P.ANALYTICS_READ), getAdminOverview);
router.get('/analytics', requirePermission(P.ANALYTICS_READ), getAdminAnalytics);

router.get('/verifications', requirePermission(P.VERIFICATIONS_READ), listAdminVerifications);
router.get('/verifications/:userId', requirePermission(P.VERIFICATIONS_READ), getAdminVerification);
router.get(
  '/verifications/:userId/documents/:docId',
  requirePermission(P.DOCUMENTS_READ),
  getAdminVerificationDocument,
);
router.post('/verifications/:userId/approve', requirePermission(P.VERIFICATIONS_APPROVE), approveAdminVerification);
router.post(
  '/verifications/:userId/reject',
  requirePermission(P.VERIFICATIONS_APPROVE),
  validateBody(adminRejectVerificationSchema),
  rejectAdminVerification,
);

router.post(
  '/accounts/:id/suspend',
  requirePermission(P.USERS_WRITE),
  validateBody(adminSuspendUserSchema),
  suspendAdminUser,
);
router.post('/accounts/:id/unsuspend', requirePermission(P.USERS_WRITE), unsuspendAdminUser);

router.get('/professionals', requirePermission(P.PROFESSIONALS_READ), listAdminProfessionals);
router.get('/professionals/:id', requirePermission(P.PROFESSIONALS_READ), getAdminProfessional);
router.patch(
  '/professionals/:id',
  requirePermission(P.PROFESSIONALS_WRITE),
  validateBody(adminPatchProfessionalSchema),
  patchAdminProfessional,
);
router.get(
  '/professionals/:id/storefront',
  requirePermission(P.PROFESSIONALS_READ),
  getAdminProfessionalStorefront,
);
router.get(
  '/professionals/:id/storefront/draft',
  requirePermission(P.PROFESSIONALS_READ),
  getAdminProfessionalStorefrontDraft,
);
router.get(
  '/professionals/:id/storefront/properties',
  requirePermission(P.PROFESSIONALS_READ),
  getAdminProfessionalStorefrontProperties,
);
router.put(
  '/professionals/:id/storefront/draft',
  requirePermission(P.PROFESSIONALS_WRITE),
  validateBody(saveStorefrontDraftSchema),
  saveAdminProfessionalStorefrontDraft,
);
router.post(
  '/professionals/:id/storefront/publish',
  requirePermission(P.PROFESSIONALS_WRITE),
  validateBody(publishStorefrontSchema),
  publishAdminProfessionalStorefront,
);
router.post(
  '/professionals/:id/storefront/generate',
  requirePermission(P.PROFESSIONALS_WRITE),
  validateBody(generateStorefrontDraftSchema),
  generateAdminProfessionalStorefrontDraft,
);
router.post(
  '/professionals/:id/storefront/upload-image',
  requirePermission(P.PROFESSIONALS_WRITE),
  runProfileUpload,
  uploadAdminProfessionalStorefrontImage,
);

router.get(
  '/professionals/:id/chatbot/embeds',
  requirePermission(P.PROFESSIONALS_READ),
  listAdminProfessionalChatbotEmbeds,
);
router.post(
  '/professionals/:id/chatbot/embeds/generate',
  requirePermission(P.PROFESSIONALS_WRITE),
  validateBody(embedGenerateBodySchema),
  generateAdminProfessionalChatbotEmbed,
);
router.patch(
  '/professionals/:id/chatbot/embeds/:embedId',
  requirePermission(P.PROFESSIONALS_WRITE),
  validateBody(embedPatchBodySchema),
  patchAdminProfessionalChatbotEmbed,
);
router.delete(
  '/professionals/:id/chatbot/embeds/:embedId',
  requirePermission(P.PROFESSIONALS_WRITE),
  deleteAdminProfessionalChatbotEmbed,
);

router.get('/clients', requirePermission(P.CLIENTS_READ), listAdminClients);
router.get('/clients/:id', requirePermission(P.CLIENTS_READ), getAdminClient);
router.patch(
  '/clients/:id',
  requirePermission(P.CLIENTS_WRITE),
  validateBody(adminPatchClientSchema),
  patchAdminClient,
);

router.get('/leads', requirePermission(P.LEADS_READ), listAdminLeads);
router.get('/leads/:id/conversation', requirePermission(P.LEADS_READ), getAdminLeadConversation);
router.get('/leads/:id/property-matches', requirePermission(P.LEADS_READ), getAdminLeadPropertyMatches);
router.get('/leads/:id/inquired-property', requirePermission(P.LEADS_READ), getAdminLeadInquiredProperty);
router.post('/leads/:id/insights/analyze', requirePermission(P.LEADS_WRITE), analyzeAdminLeadInsights);
router.post(
  '/leads/:id/conversation/message',
  requirePermission(P.LEADS_WRITE),
  validateBody(leadConversationMessageSchema),
  adminPostLeadConversationMessage,
);
router.post(
  '/leads/:id/nurture/draft',
  requirePermission(P.LEADS_WRITE),
  validateBody(nurtureDraftBodySchema),
  adminNurtureDraft,
);
router.post(
  '/leads/:id/nurture/refine',
  requirePermission(P.LEADS_WRITE),
  validateBody(nurtureRefineBodySchema),
  adminNurtureRefine,
);
router.post(
  '/leads/:id/nurture/preview',
  requirePermission(P.LEADS_WRITE),
  validateBody(nurturePreviewBodySchema),
  adminNurturePreview,
);
router.post(
  '/leads/:id/nurture/send',
  requirePermission(P.LEADS_WRITE),
  validateBody(nurtureSendBodySchema),
  adminNurtureSend,
);
router.get('/leads/:id/nurture/logs', requirePermission(P.LEADS_READ), adminNurtureLogs);
router.get('/leads/:id/referrals', requirePermission(P.LEADS_READ), adminListLeadReferrals);
router.post(
  '/leads/:id/referrals',
  requirePermission(P.LEADS_WRITE),
  validateBody(referralPostBodySchema),
  adminCreateLeadReferral,
);
router.post(
  '/leads/:id/calendly/cancel-booking',
  requirePermission(P.LEADS_WRITE),
  validateBody(adminCalendlyCancelBookingBodySchema),
  adminCancelLeadCalendlyBooking,
);
router.get(
  '/referrals/:id/lead-details',
  requirePermission(P.REFERRALS_READ),
  validateQuery(adminActingUserIdSchema),
  adminReferralLeadDetails,
);
router.post(
  '/referrals/:id/process',
  requirePermission(P.REFERRALS_WRITE),
  validateActingUserId(adminActingUserIdSchema),
  adminProcessReferralAsProfessional,
);
router.patch(
  '/referrals/:id/as-professional',
  requirePermission(P.REFERRALS_WRITE),
  validateActingUserId(adminActingUserIdSchema),
  validateBody(referralPatchBodySchema.keys({ acting_user_id: objectId.optional() })),
  adminPatchReferralAsProfessional,
);
router.get('/leads/:id', requirePermission(P.LEADS_READ), getAdminLead);
router.patch('/leads/:id', requirePermission(P.LEADS_WRITE), validateBody(adminPatchLeadSchema), patchAdminLead);
router.delete('/leads/:id', requirePermission(P.LEADS_WRITE), deleteAdminLead);

router.get('/properties', requirePermission(P.PROPERTIES_READ), listAdminProperties);
router.get('/properties/:id', requirePermission(P.PROPERTIES_READ), getAdminProperty);
router.patch(
  '/properties/:id',
  requirePermission(P.PROPERTIES_WRITE),
  validateBody(adminPatchPropertySchema),
  patchAdminProperty,
);
router.delete('/properties/:id', requirePermission(P.PROPERTIES_WRITE), deleteAdminProperty);

router.get('/subscriptions', requirePermission(P.SUBSCRIPTIONS_READ), listAdminSubscriptions);
router.get('/subscriptions/:userId', requirePermission(P.SUBSCRIPTIONS_READ), getAdminSubscription);
router.patch(
  '/subscriptions/:userId',
  requirePermission(P.SUBSCRIPTIONS_WRITE),
  validateBody(adminPatchSubscriptionSchema),
  patchAdminSubscription,
);

router.get('/referrals', requirePermission(P.REFERRALS_READ), listAdminReferrals);
router.get('/referrals/:id', requirePermission(P.REFERRALS_READ), getAdminReferral);
router.patch(
  '/referrals/:id',
  requirePermission(P.REFERRALS_WRITE),
  validateBody(adminPatchReferralSchema),
  patchAdminReferral,
);

router.get('/sales-pipeline', requirePermission(P.LEADS_READ), adminListSalesPipeline);
router.post('/voice/calls', adminStartVoiceCall);
router.post('/voice/calls/:id/stop', adminStopVoiceCall);
router.get('/voice/calls', adminListVoiceCalls);
router.get('/voice/calls/:id/recordings', adminListCallRecordings);
router.get('/voice/recordings/:id/playback', adminRecordingPlayback);
router.get('/voice/calls/:id/transcript', adminCallTranscript);
router.get('/voice/calls/:id/suggestions', adminListVoiceSuggestions);
router.post('/voice/suggestions/:id/decision', adminDecideVoiceSuggestion);

export default router;
