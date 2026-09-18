import express from 'express';
import { protect, ensureAdmin, requirePermission } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
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
} from '../schemas/adminSchemas.js';
import {
  getAdminOverview,
  getAdminAnalytics,
  suspendAdminUser,
  unsuspendAdminUser,
  listAdminProfessionals,
  getAdminProfessional,
  patchAdminProfessional,
  listAdminClients,
  getAdminClient,
  patchAdminClient,
  listAdminLeads,
  getAdminLead,
  patchAdminLead,
  deleteAdminLead,
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

router.get('/clients', requirePermission(P.CLIENTS_READ), listAdminClients);
router.get('/clients/:id', requirePermission(P.CLIENTS_READ), getAdminClient);
router.patch(
  '/clients/:id',
  requirePermission(P.CLIENTS_WRITE),
  validateBody(adminPatchClientSchema),
  patchAdminClient,
);

router.get('/leads', requirePermission(P.LEADS_READ), listAdminLeads);
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

export default router;
