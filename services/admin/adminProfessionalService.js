import mongoose from 'mongoose';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import Referral from '../../models/Referral.js';
import Subscription from '../../models/Subscription.js';
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
import { serializeCredentialStateAsync } from '../credentials/credentialService.js';
import { evaluateProfessionalProfileSetup } from '../../utils/professionalProfileSetup.js';
import { CREDENTIAL_STATUS_VALUES } from '../../constants/credentialDocuments.js';

const LIST_SELECT =
  'user_id professional_type full_name company_name phone location website license_number credential_status country jurisdiction createdAt updatedAt';

export async function listAdminProfessionalsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const and = [];
  if (query.professional_type) and.push({ professional_type: query.professional_type });
  if (query.credential_status && CREDENTIAL_STATUS_VALUES.includes(query.credential_status)) {
    and.push({ credential_status: query.credential_status });
  }
  const dateFilter = {};
  applyDateRange(dateFilter, query, 'createdAt');
  if (dateFilter.createdAt) and.push({ createdAt: dateFilter.createdAt });

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    const userIds = await findUserIdsBySearch(query.q);
    and.push({
      $or: [
        { full_name: rx },
        { company_name: rx },
        { phone: rx },
        { location: rx },
        ...(userIds?.length ? [{ user_id: { $in: userIds } }] : []),
      ],
    });
  }

  if (query.status === 'active' || query.status === 'suspended') {
    const users = await User.find({
      is_active: query.status === 'active' ? { $ne: false } : false,
    })
      .select('_id')
      .lean();
    and.push({ user_id: { $in: users.map((u) => u._id) } });
  }

  const filter = and.length ? { $and: and } : {};
  const sort = parseSort(query, ['createdAt', 'updatedAt', 'full_name'], { updatedAt: -1 });

  const [items, total] = await Promise.all([
    ProfessionalProfile.find(filter)
      .select(LIST_SELECT)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user_id', USER_LIST)
      .lean(),
    ProfessionalProfile.countDocuments(filter),
  ]);

  return ok({
    items: items.map((row) => ({
      id: String(row._id),
      user: serializeUser(row.user_id),
      professional_type: row.professional_type,
      full_name: row.full_name || '',
      company_name: row.company_name || '',
      phone: row.phone || '',
      location: row.location || '',
      website: row.website || '',
      license_number: row.license_number || '',
      credential_status: row.credential_status || null,
      country: row.country || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}

export async function getAdminProfessionalService(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid professional id');
  const profile = await ProfessionalProfile.findById(id).populate('user_id', USER_PUBLIC);
  if (!profile) return fail(404, 'Professional not found');

  const userId = profile.user_id?._id || profile.user_id;
  const [leadCount, recentLeads, referralFrom, referralTo, subscription, verification] = await Promise.all([
    LeadMatch.countDocuments({ user_id: userId }),
    LeadMatch.find({ user_id: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('lead_type match_status createdAt compatibility_factors')
      .lean(),
    Referral.countDocuments({ user_id: userId }),
    Referral.countDocuments({ target_user_id: userId }),
    Subscription.findOne({ user_id: userId }).lean(),
    serializeCredentialStateAsync(profile, profile.user_id?.role || profile.professional_type, {
      audience: 'admin',
    }),
  ]);

  const lean = profile.toObject();
  const completeness = evaluateProfessionalProfileSetup(profile.user_id, lean);

  return ok({
    professional: {
      ...lean,
      id: String(profile._id),
      user: serializeUser(profile.user_id),
      credential_events: undefined,
    },
    verification,
    documents: (verification.documents || []).map((doc) => ({
      id: doc.id,
      type: doc.type,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      uploaded_at: doc.uploaded_at,
      status: doc.status,
    })),
    subscription: subscription
      ? {
          plan_key: subscription.plan_key,
          status: subscription.status,
          trial_start: subscription.trial_start,
          trial_end: subscription.trial_end,
          current_period_end: subscription.current_period_end,
          cancel_at_period_end: subscription.cancel_at_period_end,
        }
      : null,
    completeness: {
      is_complete: Boolean(completeness?.is_complete),
      personal_complete: Boolean(completeness?.personal_complete),
      business_complete: Boolean(completeness?.business_complete),
      missing_fields: completeness?.missing_fields || [],
    },
    stats: {
      leads_owned: leadCount,
      referrals_sent: referralFrom,
      referrals_received: referralTo,
    },
    recent_leads: recentLeads.map((lead) => ({
      id: String(lead._id),
      lead_type: lead.lead_type || '',
      match_status: lead.match_status || '',
      createdAt: lead.createdAt,
      title:
        lead.compatibility_factors?.property_inquiry?.title
        || lead.compatibility_factors?.client_profile?.full_name
        || lead.lead_type
        || 'Lead',
    })),
  });
}

export async function patchAdminProfessionalService(id, patch = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid professional id');
  const profile = await ProfessionalProfile.findById(id);
  if (!profile) return fail(404, 'Professional not found');

  for (const key of ['full_name', 'company_name', 'phone', 'location', 'professional_type', 'website', 'license_number']) {
    if (patch[key] !== undefined) profile[key] = patch[key];
  }
  await profile.save();
  return getAdminProfessionalService(id);
}
