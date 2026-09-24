import {
  getAdminOverviewService,
  getAdminAnalyticsService,
  suspendAdminUserService,
  unsuspendAdminUserService,
  listAdminProfessionalsService,
  getAdminProfessionalService,
  patchAdminProfessionalService,
  getAdminProfessionalStorefrontService,
  getAdminProfessionalStorefrontDraftService,
  getAdminProfessionalStorefrontPropertiesService,
  saveAdminProfessionalStorefrontDraftService,
  publishAdminProfessionalStorefrontService,
  generateAdminProfessionalStorefrontDraftService,
  uploadAdminProfessionalStorefrontImageService,
  listAdminClientsService,
  getAdminClientService,
  patchAdminClientService,
  listAdminLeadsService,
  getAdminLeadService,
  patchAdminLeadService,
  deleteAdminLeadService,
  getAdminLeadConversationService,
  getAdminLeadPropertyMatchesService,
  getAdminLeadInquiredPropertyService,
  analyzeAdminLeadInsightsService,
  adminPostLeadConversationMessageService,
  adminNurtureDraftService,
  adminNurtureRefineService,
  adminNurturePreviewService,
  adminNurtureSendService,
  adminNurtureLogsService,
  adminListLeadReferralsService,
  adminCreateLeadReferralService,
  adminPatchReferralAsProfessionalService,
  adminProcessReferralAsProfessionalService,
  adminReferralLeadDetailsService,
  adminCancelLeadCalendlyBookingService,
  listAdminProfessionalChatbotEmbedsService,
  generateAdminProfessionalChatbotEmbedService,
  patchAdminProfessionalChatbotEmbedService,
  deleteAdminProfessionalChatbotEmbedService,
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

function revisionExpectation(req) {
  const expected = {
    ...(req.body?.expected_revision_id !== undefined
      ? { revisionId: req.body.expected_revision_id }
      : {}),
    ...(req.body?.expected_revision_version !== undefined
      ? { revisionVersion: req.body.expected_revision_version }
      : {}),
  };
  const ifMatch = String(req.get('If-Match') || '').trim().replace(/^W\//, '').replaceAll('"', '');
  if (ifMatch && expected.revisionId === undefined) {
    const separator = ifMatch.lastIndexOf(':');
    if (separator > 0 && /^\d+$/.test(ifMatch.slice(separator + 1))) {
      expected.revisionId = ifMatch.slice(0, separator);
      expected.revisionVersion = Number(ifMatch.slice(separator + 1));
    } else {
      expected.revisionId = ifMatch;
    }
  }
  return expected;
}

function sendRevision(res, result, key) {
  const revision = result.body?.[key];
  if (revision?.revision_id) {
    res.set('ETag', `"${revision.revision_id}:${revision.revision_version || 0}"`);
  }
  send(res, result);
}

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

export const getAdminProfessionalStorefront = handle((req) =>
  getAdminProfessionalStorefrontService(req.params.id),
);
export const getAdminProfessionalStorefrontDraft = handle((req) =>
  getAdminProfessionalStorefrontDraftService(req.params.id),
);
export const getAdminProfessionalStorefrontProperties = handle((req) =>
  getAdminProfessionalStorefrontPropertiesService(req.params.id),
);
export const saveAdminProfessionalStorefrontDraft = async (req, res, next) => {
  try {
    sendRevision(
      res,
      await saveAdminProfessionalStorefrontDraftService(
        req.params.id,
        req.body.draft,
        revisionExpectation(req),
      ),
      'draft',
    );
  } catch (error) {
    next(error);
  }
};
export const publishAdminProfessionalStorefront = async (req, res, next) => {
  try {
    sendRevision(
      res,
      await publishAdminProfessionalStorefrontService(
        req.params.id,
        req.body?.draft,
        revisionExpectation(req),
      ),
      'published',
    );
  } catch (error) {
    next(error);
  }
};
export const generateAdminProfessionalStorefrontDraft = async (req, res, next) => {
  try {
    send(res, await generateAdminProfessionalStorefrontDraftService(req.params.id, req.body || {}));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const uploadAdminProfessionalStorefrontImage = async (req, res, next) => {
  try {
    send(
      res,
      await uploadAdminProfessionalStorefrontImageService(
        req.params.id,
        { file: req.file, kind: req.body?.kind },
        req.user,
      ),
    );
  } catch (error) {
    next(error);
  }
};

export const listAdminProfessionalChatbotEmbeds = handle((req) =>
  listAdminProfessionalChatbotEmbedsService(req.params.id),
);
export const generateAdminProfessionalChatbotEmbed = handle((req) =>
  generateAdminProfessionalChatbotEmbedService(req.params.id, req.body || {}),
);
export const patchAdminProfessionalChatbotEmbed = handle((req) =>
  patchAdminProfessionalChatbotEmbedService(req.params.id, req.params.embedId, req.body || {}),
);
export const deleteAdminProfessionalChatbotEmbed = handle((req) =>
  deleteAdminProfessionalChatbotEmbedService(req.params.id, req.params.embedId),
);

export const listAdminClients = handle((req) => listAdminClientsService(req.query));
export const getAdminClient = handle((req) => getAdminClientService(req.params.id));
export const patchAdminClient = handle((req) => patchAdminClientService(req.params.id, req.body));

export const listAdminLeads = handle((req) => listAdminLeadsService(req.query));
export const getAdminLead = handle((req) => getAdminLeadService(req.params.id, req));
export const patchAdminLead = handle((req) => patchAdminLeadService(req.params.id, req.body, req));
export const deleteAdminLead = handle((req) => deleteAdminLeadService(req.params.id, req.user));
export const getAdminLeadConversation = handle((req) =>
  getAdminLeadConversationService(req.params.id, req.query),
);
export const getAdminLeadPropertyMatches = handle((req) =>
  getAdminLeadPropertyMatchesService(req.params.id, req.query),
);
export const getAdminLeadInquiredProperty = handle((req) =>
  getAdminLeadInquiredPropertyService(req.params.id, req),
);
export const analyzeAdminLeadInsights = handle((req) =>
  analyzeAdminLeadInsightsService(req.params.id, req.query),
);

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
  patchAdminReferralService(req.params.id, req.body, req.user),
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

export const adminPostLeadConversationMessage = handle((req) =>
  adminPostLeadConversationMessageService(req.params.id, req.body, req.user),
);
export const adminNurtureDraft = handle((req) =>
  adminNurtureDraftService(req.params.id, req.body, req.user),
);
export const adminNurtureRefine = handle((req) =>
  adminNurtureRefineService(req.params.id, req.body, req.user),
);
export const adminNurturePreview = handle((req) =>
  adminNurturePreviewService(req.params.id, req.body, req.user),
);
export const adminNurtureSend = handle((req) =>
  adminNurtureSendService(req.params.id, req.body, req.user),
);
export const adminNurtureLogs = handle((req) => adminNurtureLogsService(req.params.id, req.query));
export const adminListLeadReferrals = handle((req) => adminListLeadReferralsService(req.params.id));
export const adminCreateLeadReferral = handle((req) =>
  adminCreateLeadReferralService(req.params.id, req.body, req.user),
);
export const adminPatchReferralAsProfessional = handle((req) =>
  adminPatchReferralAsProfessionalService(
    req.params.id,
    req.body,
    req.body?.acting_user_id || req.query.acting_user_id,
    req.user,
  ),
);
export const adminProcessReferralAsProfessional = handle((req) =>
  adminProcessReferralAsProfessionalService(
    req.params.id,
    req.body?.acting_user_id || req.query.acting_user_id,
    req.user,
  ),
);
export const adminReferralLeadDetails = handle((req) =>
  adminReferralLeadDetailsService(
    req.params.id,
    req.validatedQuery?.acting_user_id ?? req.query?.acting_user_id,
  ),
);
export const adminCancelLeadCalendlyBooking = handle((req) =>
  adminCancelLeadCalendlyBookingService(req.params.id, req.body, req.user),
);
