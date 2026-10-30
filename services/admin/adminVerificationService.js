import mongoose from 'mongoose';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import {
  CREDENTIAL_COUNTRY_VALUES,
  CREDENTIAL_STATUS,
  CREDENTIAL_STATUS_VALUES,
} from '../../constants/credentialDocuments.js';
import { PROFESSIONAL_TYPE_VALUES } from '../../constants/roles.js';
import {
  approveCredentialsService,
  loadCredentialDocumentFile,
  rejectCredentialsService,
  serializeCredentialStateAsync,
} from '../credentials/credentialService.js';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listAdminVerificationsService({
  status = 'all',
  role = '',
  country = '',
  q = '',
  page = 1,
  limit = 20,
} = {}) {
  // Unknown filter values are ignored rather than applied verbatim, which would
  // silently return an empty queue instead of the full list.
  const filter = {};
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedStatus && normalizedStatus !== 'all' && CREDENTIAL_STATUS_VALUES.includes(normalizedStatus)) {
    filter.credential_status = normalizedStatus;
  }
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole && PROFESSIONAL_TYPE_VALUES.includes(normalizedRole)) {
    filter.professional_type = normalizedRole;
  }
  const normalizedCountry = String(country || '').trim().toUpperCase();
  if (normalizedCountry && CREDENTIAL_COUNTRY_VALUES.includes(normalizedCountry)) {
    filter.country = normalizedCountry;
  }

  let userIds = null;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({
      $or: [{ email: rx }, { first_name: rx }, { last_name: rx }],
    })
      .select('_id')
      .lean();
    userIds = users.map((u) => u._id);
    filter.user_id = { $in: userIds };
  }

  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
  const take = Math.min(100, Math.max(1, limit));

  const [total, profiles] = await Promise.all([
    ProfessionalProfile.countDocuments(filter),
    ProfessionalProfile.find(filter)
      .sort({ credential_submitted_at: -1, updatedAt: -1 })
      .skip(skip)
      .limit(take)
      .lean(),
  ]);

  const ids = profiles.map((p) => p.user_id);
  const users = await User.find({ _id: { $in: ids } })
    .select('first_name last_name email role is_active createdAt profile_image')
    .lean();
  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  const items = profiles.map((profile) => {
    const user = userMap[String(profile.user_id)] || null;
    return {
      user_id: String(profile.user_id),
      credential_status: profile.credential_status || CREDENTIAL_STATUS.NOT_STARTED,
      country: profile.country || null,
      jurisdiction: profile.jurisdiction || '',
      professional_type: profile.professional_type,
      license_number: profile.license_number || '',
      company_name: profile.company_name || '',
      nmls_id: profile.nmls_id || '',
      credential_submitted_at: profile.credential_submitted_at || null,
      credential_reviewed_at: profile.credential_reviewed_at || null,
      document_count: (profile.credential_documents || []).length,
      user: user
        ? {
            id: String(user._id),
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            role: user.role,
            is_active: user.is_active !== false,
            createdAt: user.createdAt,
            profile_image: user.profile_image || null,
          }
        : null,
    };
  });

  const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
    ProfessionalProfile.countDocuments({
      credential_status: CREDENTIAL_STATUS.PENDING_REVIEW,
    }),
    ProfessionalProfile.countDocuments({
      credential_status: CREDENTIAL_STATUS.APPROVED,
    }),
    ProfessionalProfile.countDocuments({
      credential_status: CREDENTIAL_STATUS.REJECTED,
    }),
  ]);

  return {
    status: 200,
    body: {
      success: true,
      items,
      pending_count: pendingCount,
      counts: {
        pending_review: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
      pagination: {
        page: Math.max(1, page),
        limit: take,
        total,
        pages: Math.max(1, Math.ceil(total / take)),
      },
    },
  };
}

export async function getAdminVerificationService(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { status: 400, body: { success: false, message: 'Invalid user id' } };
  }
  const [user, profile] = await Promise.all([
    User.findById(userId)
      .select('first_name last_name email role phone is_active createdAt profile_image')
      .lean(),
    ProfessionalProfile.findOne({ user_id: userId }),
  ]);
  if (!user || !profile) {
    return { status: 404, body: { success: false, message: 'Verification record not found' } };
  }

  return {
    status: 200,
    body: {
      success: true,
      user: {
        id: String(user._id),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        phone: user.phone || '',
        is_active: user.is_active !== false,
        createdAt: user.createdAt,
        profile_image: user.profile_image || null,
      },
      profile: {
        id: String(profile._id),
        professional_type: profile.professional_type,
        full_name: profile.full_name,
        company_name: profile.company_name,
        phone: profile.phone,
        location: profile.location,
        website: profile.website || '',
      },
      ...(await serializeCredentialStateAsync(profile, user.role, { audience: 'admin' })),
    },
  };
}

export async function approveAdminVerificationService({ userId, adminId }) {
  return approveCredentialsService({ userId, adminId });
}

export async function rejectAdminVerificationService({ userId, adminId, reason }) {
  return rejectCredentialsService({ userId, adminId, reason });
}

export async function getAdminVerificationDocumentService({ userId, docId }) {
  return loadCredentialDocumentFile({ userId, docId });
}

export async function countPendingVerifications() {
  return ProfessionalProfile.countDocuments({
    credential_status: CREDENTIAL_STATUS.PENDING_REVIEW,
  });
}
