import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import User from '../../models/User.js';
import { isProfessionalRole } from '../../constants/roles.js';
import { LEAD_TYPES } from '../../constants/validationEnums.js';
import { parsePageLimitPagination, PAGINATION_PRESETS } from '../../utils/pagination.js';
import { patchLeadMatchForUser, deleteOwnedLeadMatch } from '../lead/leadMatchFollowUpSync.js';
import {
  buildLeadConversationPayload,
  formatLeadDetailApiResponse,
} from '../lead/leadProfileHelpers.js';
import { buildInquiredPropertyPayload } from '../lead/inquiredProperty.js';
import { buildLeadPropertyMatchesPayload } from '../lead/leadPropertyMatchHelpers.js';
import { getCachedLeadIntelligence } from '../ai/leadInsights.js';
import {
  USER_LIST,
  USER_PUBLIC,
  parsePaging,
  escapeRegex,
  applyDateRange,
  parseSort,
  findUserIdsBySearch,
  ok,
  fail,
  serializeUser,
} from './adminCommon.js';
import {
  buildLeadsListMatchFilter,
  excludeAcceptedReferralRecipientMatchesFilter,
} from '../lead/leadQueryUtils.js';
import { recordAdminAudit } from './adminAuditService.js';

export const adminLeadServiceDeps = {
  deleteOwnedLeadMatch,
  recordAdminAudit,
  LeadMatch,
  WorkspaceAppointment,
  LeadProfile,
  ProfessionalChatThread,
  withRequiredTransaction: null, // set below after definition
};

const LIST_SELECT =
  'user_id lead_profile_id match_status lead_type match_score conversation_id compatibility_factors createdAt updatedAt';

const CLIENT_INITIATED_FILTER = {
  $or: [
    { 'compatibility_factors.client_user_id': { $exists: true, $nin: [null, ''] } },
    { 'compatibility_factors.source': 'client_professional_inquiry' },
    { 'compatibility_factors.source': 'client_property_inquiry' },
  ],
};

export function deriveLeadInquirySource(lead = {}) {
  const factors = lead.compatibility_factors || {};
  const raw = String(factors.source || factors.inquiry_source || '').trim().toLowerCase();
  if (raw === 'chatbot' || raw.includes('chat')) return 'chatbot';
  if (!raw && (lead.conversation_id || factors.session_id)) return 'chatbot';
  if (raw === 'public_web_form' || raw === 'form' || raw.endsWith('_form')) return 'form';
  if (
    raw === 'client_professional_inquiry'
    || raw === 'client_property_inquiry'
    || raw === 'direct_inquiry'
    || raw === 'public_inquiry'
  ) {
    return 'direct_inquiry';
  }
  if (raw) return raw;
  return 'unknown';
}

function sourceFilter(source) {
  const key = String(source || '').trim().toLowerCase();
  if (!key || key === 'all') return null;
  if (key === 'chatbot') {
    return {
      $or: [
        { conversation_id: { $exists: true, $ne: null } },
        { 'compatibility_factors.chat_thread_id': { $exists: true, $nin: [null, ''] } },
        { 'compatibility_factors.source': /chat/i },
      ],
    };
  }
  if (key === 'form') {
    return {
      $or: [
        { 'compatibility_factors.source': 'public_web_form' },
        { 'compatibility_factors.source': /form/i },
      ],
    };
  }
  if (key === 'direct_inquiry') {
    return {
      $or: [
        { 'compatibility_factors.source': 'client_professional_inquiry' },
        { 'compatibility_factors.source': 'client_property_inquiry' },
        { 'compatibility_factors.source': /direct|inquiry/i },
      ],
    };
  }
  return { 'compatibility_factors.source': key };
}

/** Leads that came from chatbot, public form, or direct inquiry. */
export function inquirySourceMatchFilter(source) {
  const specific = sourceFilter(source);
  if (specific) return specific;
  return {
    $or: [
      sourceFilter('chatbot').$or,
      sourceFilter('form').$or,
      sourceFilter('direct_inquiry').$or,
    ].flat(),
  };
}

export { sourceFilter };

function collectInquirerUserIds(leads = []) {
  const ids = [];
  for (const lead of leads) {
    const raw = lead?.compatibility_factors?.client_user_id;
    if (raw && mongoose.Types.ObjectId.isValid(String(raw))) {
      ids.push(String(raw));
    }
  }
  return [...new Set(ids)];
}

function isTransactionUnsupportedError(err) {
  const msg = String(err?.message || '');
  return (
    err?.code === 20
    || /transaction numbers are only allowed|replica set|not support.*transaction/i.test(msg)
  );
}

/**
 * Ownership transfers must be transactional. When Mongo cannot run transactions
 * (standalone), fail closed instead of partially updating lead ownership.
 */
async function withRequiredTransaction(work) {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch {
        /* ignore */
      }
    }
    if (isTransactionUnsupportedError(err)) {
      const unsupported = new Error(
        'Lead reassignment requires a replica-set MongoDB transaction and is unavailable in this environment',
      );
      unsupported.statusCode = 503;
      unsupported.code = 'TRANSACTIONS_UNAVAILABLE';
      throw unsupported;
    }
    throw err;
  } finally {
    if (session) {
      try {
        session.endSession();
      } catch {
        /* ignore */
      }
    }
  }
}

adminLeadServiceDeps.withRequiredTransaction = withRequiredTransaction;

/** @internal Exported for regression tests. */
export async function reassignLeadOwner({ lead, nextOwnerId, nextProfileId, session }) {
  const prevOwnerId = String(lead.user_id);
  const leadId = String(lead._id);
  const opts = session ? { session } : {};
  const now = new Date();
  const {
    WorkspaceAppointment: AppointmentModel,
    LeadProfile: ProfileModel,
    ProfessionalChatThread: ThreadModel,
  } = adminLeadServiceDeps;

  lead.user_id = nextOwnerId;
  // Keep conversation_id as read-only history — do not rewrite chatbot ownership.
  if (nextProfileId) {
    lead.professional_profile_id = nextProfileId;
  } else if (lead.professional_profile_id != null) {
    lead.set('professional_profile_id', undefined);
  }
  await lead.save(opts);

  const threadId = String(lead.compatibility_factors?.chat_thread_id || '').trim();
  if (threadId && mongoose.Types.ObjectId.isValid(threadId)) {
    let threadQuery = ThreadModel.findById(threadId);
    if (session) threadQuery = threadQuery.session(session);
    const thread = await threadQuery;
    if (thread && String(thread.participants_key || '').startsWith(`lead:${leadId}:`)) {
      const participants = (thread.participants || []).map((p) => String(p));
      const replaced = participants.map((p) => (p === prevOwnerId ? String(nextOwnerId) : p));
      const unique = [...new Set(replaced)];
      if (unique.length >= 2) {
        thread.participants = unique;
        await thread.save(opts);
      }
    }
  }

  // Move future/booked appointments so cancel/reconcile works for the new owner.
  await AppointmentModel.updateMany(
    {
      lead_match_id: lead._id,
      user_id: prevOwnerId,
      status: 'booked',
      $or: [
        { scheduled_start: { $gte: now } },
        { scheduled_start: null },
      ],
    },
    { $set: { user_id: nextOwnerId } },
    opts,
  );

  // Keep compatible lead profile ownership aligned with the lead match owner.
  const profileId = lead.lead_profile_id;
  if (profileId) {
    await ProfileModel.updateOne(
      { _id: profileId, 'ownership.user_id': prevOwnerId },
      { $set: { 'ownership.user_id': nextOwnerId } },
      opts,
    );
  }

  return { prevOwnerId, nextOwnerId: String(nextOwnerId) };
}

function applyLeadFieldsInTransaction(lead, patch = {}) {
  if (patch.match_status !== undefined) lead.match_status = patch.match_status;
  if (patch.note !== undefined) lead.note = patch.note;
  if (patch.close_reason !== undefined) lead.close_reason = patch.close_reason;
  if (patch.closed_value !== undefined) lead.closed_value = patch.closed_value;
  if (patch.agent_closing_checklist !== undefined) {
    lead.agent_closing_checklist = patch.agent_closing_checklist;
  }
  if (patch.lawyer_closing_checklist !== undefined) {
    lead.lawyer_closing_checklist = patch.lawyer_closing_checklist;
  }
  if (patch.mortgage_closing_checklist !== undefined) {
    lead.mortgage_closing_checklist = patch.mortgage_closing_checklist;
  }
  if (patch.lead_type !== undefined) {
    if (!LEAD_TYPES.includes(String(patch.lead_type))) {
      const err = new Error('Invalid lead type');
      err.statusCode = 400;
      throw err;
    }
    lead.lead_type = patch.lead_type;
  }
}

export async function listAdminLeadsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const and = [];
  const ownerUserIdRaw = query.user_id != null ? String(query.user_id).trim() : '';
  if (ownerUserIdRaw && !mongoose.Types.ObjectId.isValid(ownerUserIdRaw)) {
    return fail(400, 'Invalid owner user id');
  }
  const ownerUserId = ownerUserIdRaw;
  const ownerScoped = Boolean(ownerUserId);
  if (query.status && !ownerScoped) and.push({ match_status: query.status });
  const dateFilter = {};
  applyDateRange(dateFilter, query, 'createdAt');
  if (dateFilter.createdAt) and.push({ createdAt: dateFilter.createdAt });

  const src = sourceFilter(query.source);
  if (src) and.push(src);

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    const ownerIds = await findUserIdsBySearch(query.q);
    and.push({
      $or: [
        { lead_type: rx },
        { 'compatibility_factors.inquired_property_title': rx },
        { 'compatibility_factors.contact.email': rx },
        { 'compatibility_factors.contact.name': rx },
        { 'compatibility_factors.client_name': rx },
        { 'compatibility_factors.client_email': rx },
        ...(ownerIds?.length ? [{ user_id: { $in: ownerIds } }] : []),
      ],
    });
  }

  if (ownerScoped) {
    // Same list rules as the professional GET /api/leads for this owner.
    and.push(buildLeadsListMatchFilter(ownerUserId, {
      status: query.status || undefined,
      pipeline: query.pipeline || undefined,
    }));
    and.push(excludeAcceptedReferralRecipientMatchesFilter());
  } else {
    // Professionals tab: guest/chatbot/form leads (exclude client-initiated)
    // Clients tab: logged-in client inquiries only
    const audience = String(query.audience || 'professionals').trim().toLowerCase();
    if (audience === 'clients') {
      and.push(CLIENT_INITIATED_FILTER);
    } else if (audience === 'professionals') {
      and.push({ $nor: [CLIENT_INITIATED_FILTER] });
    }
  }

  const filter = and.length ? { $and: and } : {};
  const sort = parseSort(query, ['createdAt', 'updatedAt'], { createdAt: -1 });

  const [items, total] = await Promise.all([
    LeadMatch.find(filter)
      .select(LIST_SELECT)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user_id', USER_LIST)
      .lean(),
    LeadMatch.countDocuments(filter),
  ]);

  const inquirerIds = collectInquirerUserIds(items);
  const inquirerUsers = inquirerIds.length
    ? await User.find({ _id: { $in: inquirerIds } }).select(USER_LIST).lean()
    : [];
  const inquirerById = new Map(inquirerUsers.map((u) => [String(u._id), u]));

  return ok({
    items: items.map((lead) => {
      const factors = lead.compatibility_factors || {};
      const contact = factors.contact || {};
      const inquirerUser = factors.client_user_id
        ? inquirerById.get(String(factors.client_user_id))
        : null;
      const inquirerName =
        contact.name
        || factors.client_name
        || [inquirerUser?.first_name, inquirerUser?.last_name].filter(Boolean).join(' ')
        || '';
      const inquirerEmail =
        contact.email
        || factors.client_email
        || inquirerUser?.email
        || '';

      return {
        id: String(lead._id),
        match_status: lead.match_status,
        lead_type: lead.lead_type,
        match_score: lead.match_score,
        inquiry_source: deriveLeadInquirySource(lead),
        inquirer_name: inquirerName,
        inquirer_email: inquirerEmail,
        inquirer_image: inquirerUser?.profile_image || null,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        professional: serializeUser(lead.user_id),
        lead_profile: lead.lead_profile_id
          ? { id: String(lead.lead_profile_id._id || lead.lead_profile_id) }
          : null,
        inquired_property:
          factors.inquired_property
          || (factors.inquired_property_id
            ? {
                id: factors.inquired_property_id,
                title: factors.inquired_property_title || '',
              }
            : null),
      };
    }),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}

async function loadAdminLeadAndOwner(id, { select } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid lead id');
  let query = LeadMatch.findById(id);
  if (select) query = query.select(select);
  const lead = await query.lean();
  if (!lead) return fail(404, 'Lead not found');
  const owner = await User.findById(lead.user_id).select(USER_PUBLIC).lean();
  if (!owner) return fail(409, 'Lead owner account no longer exists');
  return { lead, owner };
}

function asOwnerRequest(req, owner) {
  return { ...req, user: owner };
}

export async function getAdminLeadService(id, req = {}) {
  const loaded = await loadAdminLeadAndOwner(id);
  if (loaded?.status) return loaded;
  const { lead, owner } = loaded;
  const payload = await formatLeadDetailApiResponse(asOwnerRequest(req, owner), owner._id, lead);

  const factors = lead.compatibility_factors || {};
  let inquirer = null;
  if (factors.client_user_id && mongoose.Types.ObjectId.isValid(String(factors.client_user_id))) {
    const user = await User.findById(factors.client_user_id).select(USER_PUBLIC).lean();
    inquirer = serializeUser(user);
  }
  const ownerProfile = await ProfessionalProfile.findOne({ user_id: owner._id }).select('_id').lean();

  return ok({
    ...payload,
    lead: {
      ...payload.lead,
      inquiry_source: deriveLeadInquirySource(lead),
      professional: serializeUser(owner),
      inquirer,
      ai_insights_ready: Boolean(getCachedLeadIntelligence(lead)),
      ai_insights_generated_at: lead.ai_insights?.generated_at || null,
    },
    admin: {
      owner: serializeUser(owner),
      owner_professional_id: ownerProfile ? String(ownerProfile._id) : null,
      lead_type: lead.lead_type,
      raw_status: lead.match_status,
    },
  });
}

export async function patchAdminLeadService(id, patch = {}, req = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid lead id');
  const lead = await LeadMatch.findById(id);
  if (!lead) return fail(404, 'Lead not found');
  const owner = await User.findById(lead.user_id).select(USER_PUBLIC).lean();
  if (!owner) return fail(409, 'Lead owner account no longer exists');

  const actorUser = req.user || null;
  let reassignmentMeta = null;

  // Validate destination owner BEFORE applying status/type patches when user_id present.
  let nextOwner = null;
  let nextProfile = null;
  if (patch.user_id !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(patch.user_id)) return fail(400, 'Invalid owner user id');
    nextOwner = await User.findById(patch.user_id).select('role').lean();
    if (!nextOwner) return fail(400, 'Owner user not found');
    if (!isProfessionalRole(nextOwner.role)) {
      return fail(400, 'Owner must be a professional account');
    }
    nextProfile = await ProfessionalProfile.findOne({ user_id: patch.user_id })
      .select('_id professional_type')
      .lean();
  }

  const professionalPatchKeys = [
    'match_status',
    'note',
    'close_reason',
    'closed_value',
    'agent_closing_checklist',
    'lawyer_closing_checklist',
    'mortgage_closing_checklist',
  ];
  const professionalPatch = Object.fromEntries(
    professionalPatchKeys
      .filter((key) => patch[key] !== undefined)
      .map((key) => [key, patch[key]]),
  );

  // Reassignment path: status/type/profile ownership must commit atomically or roll back.
  // Never apply professional patches outside the transaction when user_id is present.
  if (patch.user_id !== undefined) {
    try {
      reassignmentMeta = await adminLeadServiceDeps.withRequiredTransaction(async (session) => {
        const doc = await LeadMatch.findById(id).session(session);
        if (!doc) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
        applyLeadFieldsInTransaction(doc, {
          ...professionalPatch,
          lead_type: patch.lead_type,
        });
        return reassignLeadOwner({
          lead: doc,
          nextOwnerId: patch.user_id,
          nextProfileId: nextProfile?._id || null,
          session,
        });
      });
    } catch (err) {
      await recordAdminAudit({
        actorUserId: actorUser?._id,
        onBehalfOfUserId: owner._id,
        action: 'lead.reassign',
        targetType: 'LeadMatch',
        targetId: id,
        outcome: 'error',
        errorMessage: err?.message,
      });
      if (err?.statusCode === 404) return fail(404, 'Lead not found');
      if (err?.statusCode === 400) return fail(400, err.message || 'Invalid lead patch');
      if (err?.statusCode === 503 || err?.code === 'TRANSACTIONS_UNAVAILABLE') {
        return fail(503, err.message || 'Lead reassignment temporarily unavailable');
      }
      throw err;
    }
  } else {
    if (Object.keys(professionalPatch).length > 0) {
      await patchLeadMatchForUser({
        userId: owner._id,
        user: owner,
        actorUser,
        leadId: id,
        body: professionalPatch,
        skipPlanCheck: true,
      });
    }

    if (patch.lead_type !== undefined) {
      if (!LEAD_TYPES.includes(String(patch.lead_type))) return fail(400, 'Invalid lead type');
      const fresh = await LeadMatch.findById(id);
      if (!fresh) return fail(404, 'Lead not found');
      fresh.lead_type = patch.lead_type;
      await fresh.save();
    }
  }

  await recordAdminAudit({
    actorUserId: actorUser?._id,
    onBehalfOfUserId: reassignmentMeta?.nextOwnerId || owner._id,
    action: reassignmentMeta ? 'lead.reassign' : 'lead.patch',
    targetType: 'LeadMatch',
    targetId: id,
    meta: {
      ...(reassignmentMeta
        ? {
            from_user_id: reassignmentMeta.prevOwnerId,
            to_user_id: reassignmentMeta.nextOwnerId,
            cleared_professional_profile: !nextProfile?._id,
          }
        : {}),
      match_status: patch.match_status,
      lead_type: patch.lead_type,
    },
    outcome: 'ok',
  });

  return getAdminLeadService(id, req);
}

export async function deleteAdminLeadService(id, actorUser = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid lead id');
  const lead = await adminLeadServiceDeps.LeadMatch.findById(id).select('user_id').lean();
  if (!lead) return fail(404, 'Lead not found');
  // Admin delete may target plan-hidden leads the owner cannot manage in-app.
  await adminLeadServiceDeps.deleteOwnedLeadMatch(lead.user_id, id, { skipPlanCheck: true });
  await adminLeadServiceDeps.recordAdminAudit({
    actorUserId: actorUser?._id || actorUser?.id || null,
    onBehalfOfUserId: lead.user_id,
    action: 'lead.delete',
    targetType: 'LeadMatch',
    targetId: id,
    outcome: 'ok',
  });
  return ok({ deleted: true, id: String(lead._id) });
}

export async function getAdminLeadConversationService(id, query = {}) {
  const loaded = await loadAdminLeadAndOwner(id);
  if (loaded?.status) return loaded;
  return ok(await buildLeadConversationPayload(id, loaded.lead, query));
}

export async function getAdminLeadPropertyMatchesService(id, query = {}) {
  const loaded = await loadAdminLeadAndOwner(id);
  if (loaded?.status) return loaded;
  const pagination = parsePageLimitPagination(query, PAGINATION_PRESETS.propertyMatches);
  const payload = await buildLeadPropertyMatchesPayload({
    user: loaded.owner,
    leadMatch: loaded.lead,
    ...pagination,
  });
  return ok(payload);
}

export async function getAdminLeadInquiredPropertyService(id, req = {}) {
  const loaded = await loadAdminLeadAndOwner(id, { select: 'user_id compatibility_factors' });
  if (loaded?.status) return loaded;
  const payload = await buildInquiredPropertyPayload(asOwnerRequest(req, loaded.owner), loaded.lead);
  return ok(payload);
}

/** Cached insights only — does not generate a new analysis. */
export async function analyzeAdminLeadInsightsService(id) {
  const loaded = await loadAdminLeadAndOwner(id);
  if (loaded?.status) return loaded;
  const intelligence = getCachedLeadIntelligence(loaded.lead);
  const hasCache = Boolean(intelligence);
  return ok({
    lead_id: String(loaded.lead._id),
    conversation_id: loaded.lead.conversation_id ? String(loaded.lead.conversation_id) : null,
    intelligence,
    /** @deprecated Prefer `processed` — kept for older admin clients. */
    cached: hasCache,
    processed: hasCache,
  });
}
