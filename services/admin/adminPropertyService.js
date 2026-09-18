import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import {
  USER_LIST,
  USER_PUBLIC,
  parsePaging,
  escapeRegex,
  applyDateRange,
  parseSort,
  ok,
  fail,
  serializeUser,
} from './adminCommon.js';

function propertyFromLead(lead) {
  const cf = lead.compatibility_factors || {};
  const inquired = cf.inquired_property || null;
  const id = String(cf.inquired_property_id || inquired?.id || lead._id);
  return {
    id,
    lead_match_id: String(lead._id),
    title: cf.inquired_property_title || inquired?.title || inquired?.address || 'Property inquiry',
    address: inquired?.address || inquired?.location || '',
    price: inquired?.price || inquired?.list_price || null,
    status: cf.admin_property_status || (cf.admin_hidden ? 'hidden' : 'visible'),
    admin_hidden: Boolean(cf.admin_hidden),
    admin_notes: cf.admin_notes || '',
    professional: serializeUser(lead.user_id),
    match_status: lead.match_status,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    raw: inquired,
  };
}

export async function listAdminPropertiesService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const filter = {
    $or: [
      { 'compatibility_factors.inquired_property_id': { $exists: true, $nin: [null, ''] } },
      { 'compatibility_factors.inquired_property': { $exists: true, $ne: null } },
    ],
  };
  if (query.status === 'hidden') filter['compatibility_factors.admin_hidden'] = true;
  if (query.status === 'visible') {
    filter['compatibility_factors.admin_hidden'] = { $ne: true };
  }
  applyDateRange(filter, query, 'createdAt');
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$and = [
      {
        $or: [
          { 'compatibility_factors.inquired_property_title': rx },
          { 'compatibility_factors.inquired_property.title': rx },
          { 'compatibility_factors.inquired_property.address': rx },
        ],
      },
    ];
  }

  const sort = parseSort(query, ['createdAt', 'updatedAt'], { createdAt: -1 });

  const [items, total] = await Promise.all([
    LeadMatch.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user_id', USER_LIST)
      .lean(),
    LeadMatch.countDocuments(filter),
  ]);

  return ok({
    items: items.map(propertyFromLead),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}

export async function getAdminPropertyService(id) {
  let lead = null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    lead = await LeadMatch.findById(id).populate('user_id', USER_PUBLIC).lean();
  }
  if (!lead) {
    lead = await LeadMatch.findOne({ 'compatibility_factors.inquired_property_id': String(id) })
      .populate('user_id', USER_PUBLIC)
      .lean();
  }
  if (!lead) return fail(404, 'Property not found');
  return ok({ property: propertyFromLead(lead) });
}

export async function patchAdminPropertyService(id, patch = {}) {
  let lead = null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    lead = await LeadMatch.findById(id);
  }
  if (!lead) {
    lead = await LeadMatch.findOne({ 'compatibility_factors.inquired_property_id': String(id) });
  }
  if (!lead) return fail(404, 'Property not found');

  const factors = { ...(lead.compatibility_factors || {}) };
  if (patch.admin_hidden !== undefined) {
    factors.admin_hidden = Boolean(patch.admin_hidden);
    factors.admin_property_status = factors.admin_hidden ? 'hidden' : 'visible';
  }
  if (patch.admin_notes !== undefined) factors.admin_notes = String(patch.admin_notes || '');
  if (patch.title !== undefined) {
    factors.inquired_property_title = String(patch.title || '');
    if (factors.inquired_property && typeof factors.inquired_property === 'object') {
      factors.inquired_property = { ...factors.inquired_property, title: String(patch.title || '') };
    }
  }
  lead.compatibility_factors = factors;
  lead.markModified('compatibility_factors');
  await lead.save();
  return getAdminPropertyService(String(lead._id));
}

export async function deleteAdminPropertyService(id) {
  return patchAdminPropertyService(id, { admin_hidden: true });
}
