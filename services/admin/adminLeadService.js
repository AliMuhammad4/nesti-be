import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import User from '../../models/User.js';
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
  if (raw === 'public_web_form' || raw.includes('form')) return 'form';
  if (
    raw === 'client_professional_inquiry'
    || raw === 'client_property_inquiry'
    || raw.includes('direct')
    || raw.includes('inquiry')
  ) {
    return 'direct_inquiry';
  }
  if (lead.conversation_id || factors.chat_thread_id || raw.includes('chat')) {
    return 'chatbot';
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

export async function listAdminLeadsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const and = [];
  if (query.status) and.push({ match_status: query.status });
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

  // Professionals tab: guest/chatbot/form leads (exclude client-initiated)
  // Clients tab: logged-in client inquiries only
  const audience = String(query.audience || 'professionals').trim().toLowerCase();
  if (audience === 'clients') {
    and.push(CLIENT_INITIATED_FILTER);
  } else if (audience === 'professionals') {
    and.push({ $nor: [CLIENT_INITIATED_FILTER] });
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

export async function getAdminLeadService(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid lead id');
  const lead = await LeadMatch.findById(id)
    .populate('user_id', USER_PUBLIC)
    .populate('lead_profile_id')
    .lean();
  if (!lead) return fail(404, 'Lead not found');

  const factors = lead.compatibility_factors || {};
  let inquirer = null;
  if (factors.client_user_id && mongoose.Types.ObjectId.isValid(String(factors.client_user_id))) {
    const user = await User.findById(factors.client_user_id).select(USER_PUBLIC).lean();
    inquirer = serializeUser(user);
  }

  return ok({
    lead: {
      ...lead,
      id: String(lead._id),
      inquiry_source: deriveLeadInquirySource(lead),
      professional: serializeUser(lead.user_id),
      inquirer,
    },
  });
}

export async function patchAdminLeadService(id, patch = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid lead id');
  const lead = await LeadMatch.findById(id);
  if (!lead) return fail(404, 'Lead not found');
  if (patch.match_status !== undefined) lead.match_status = patch.match_status;
  if (patch.lead_type !== undefined) lead.lead_type = patch.lead_type;
  if (patch.user_id !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(patch.user_id)) return fail(400, 'Invalid owner user id');
    lead.user_id = patch.user_id;
  }
  await lead.save();
  return getAdminLeadService(id);
}

export async function deleteAdminLeadService(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid lead id');
  const lead = await LeadMatch.findByIdAndDelete(id).lean();
  if (!lead) return fail(404, 'Lead not found');
  return ok({ deleted: true, id: String(lead._id) });
}
