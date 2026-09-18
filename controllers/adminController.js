import {
  getAdminOverviewService,
  getAdminAnalyticsService,
  suspendAdminUserService,
  unsuspendAdminUserService,
  listAdminProfessionalsService,
  getAdminProfessionalService,
  patchAdminProfessionalService,
  listAdminClientsService,
  getAdminClientService,
  patchAdminClientService,
  listAdminLeadsService,
  getAdminLeadService,
  patchAdminLeadService,
  deleteAdminLeadService,
  listAdminPropertiesService,
  getAdminPropertyService,
  patchAdminPropertyService,
  deleteAdminPropertyService,
  listAdminSubscriptionsService,
  getAdminSubscriptionService,
  patchAdminSubscriptionService,
  listAdminReferralsService,
  getAdminReferralService,
  patchAdminReferralService,
  listAdminVerificationsService,
  getAdminVerificationService,
  getAdminVerificationDocumentService,
  approveAdminVerificationService,
  rejectAdminVerificationService,
} from '../services/admin/adminService.js';

const send = (res, result) => res.status(result.status).json(result.body);

/** Thin HTTP adapter: map req → service → response. */
const handle = (fn) => async (req, res, next) => {
  try {
    send(res, await fn(req));
  } catch (error) {
    next(error);
  }
};

export const getAdminOverview = handle(() => getAdminOverviewService());

export const getAdminAnalytics = handle((req) =>
  getAdminAnalyticsService({ range: req.query.range || '30d' }),
);

export const suspendAdminUser = handle((req) =>
  suspendAdminUserService(req.user, req.params.id, req.body),
);
export const unsuspendAdminUser = handle((req) => unsuspendAdminUserService(req.params.id));

export const listAdminProfessionals = handle((req) => listAdminProfessionalsService(req.query));
export const getAdminProfessional = handle((req) => getAdminProfessionalService(req.params.id));
export const patchAdminProfessional = handle((req) =>
  patchAdminProfessionalService(req.params.id, req.body),
);

export const listAdminClients = handle((req) => listAdminClientsService(req.query));
export const getAdminClient = handle((req) => getAdminClientService(req.params.id));
export const patchAdminClient = handle((req) => patchAdminClientService(req.params.id, req.body));

export const listAdminLeads = handle((req) => listAdminLeadsService(req.query));
export const getAdminLead = handle((req) => getAdminLeadService(req.params.id));
export const patchAdminLead = handle((req) => patchAdminLeadService(req.params.id, req.body));
export const deleteAdminLead = handle((req) => deleteAdminLeadService(req.params.id));

export const listAdminProperties = handle((req) => listAdminPropertiesService(req.query));
export const getAdminProperty = handle((req) => getAdminPropertyService(req.params.id));
export const patchAdminProperty = handle((req) =>
  patchAdminPropertyService(req.params.id, req.body),
);
export const deleteAdminProperty = handle((req) => deleteAdminPropertyService(req.params.id));

export const listAdminSubscriptions = handle((req) => listAdminSubscriptionsService(req.query));
export const getAdminSubscription = handle((req) =>
  getAdminSubscriptionService(req.params.userId),
);
export const patchAdminSubscription = handle((req) =>
  patchAdminSubscriptionService(req.params.userId, req.body),
);

export const listAdminReferrals = handle((req) => listAdminReferralsService(req.query));
export const getAdminReferral = handle((req) => getAdminReferralService(req.params.id));
export const patchAdminReferral = handle((req) =>
  patchAdminReferralService(req.params.id, req.body),
);

export const listAdminVerifications = handle((req) =>
  listAdminVerificationsService({
    status: req.query.status,
    role: req.query.role,
    country: req.query.country,
    q: req.query.q,
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  }),
);
export const getAdminVerification = handle((req) =>
  getAdminVerificationService(req.params.userId),
);

/** Binary stream — not JSON. */
export const getAdminVerificationDocument = async (req, res, next) => {
  try {
    const result = await getAdminVerificationDocumentService({
      userId: req.params.userId,
      docId: req.params.docId,
    });
    if (result.body || !result.file) {
      return res.status(result.status || 500).json(result.body || { success: false, message: 'Failed to load document' });
    }
    const { buffer, contentType, fileName, contentLength } = result.file;
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${fileName || 'document'}"`);
    res.setHeader('Cache-Control', 'private, max-age=120');
    if (contentLength != null) res.setHeader('Content-Length', String(contentLength));
    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
};

export const approveAdminVerification = handle((req) =>
  approveAdminVerificationService({
    userId: req.params.userId,
    adminId: req.user._id,
  }),
);
export const rejectAdminVerification = handle((req) =>
  rejectAdminVerificationService({
    userId: req.params.userId,
    adminId: req.user._id,
    reason: req.body?.reason,
  }),
);
