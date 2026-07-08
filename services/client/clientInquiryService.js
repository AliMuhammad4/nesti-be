import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import PublicProfile from '../../models/PublicProfile.js';
import User from '../../models/User.js';
import { isProfessionalRole } from '../../constants/roles.js';
import { toObjectId } from '../../utils/proChatUtils.js';

const USER_SELECT = 'first_name last_name email role profile_image phone';

function professionalDisplayName(user, profile) {
  const fromProfile = String(profile?.full_name || '').trim();
  if (fromProfile) return fromProfile;
  const joined = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return joined || user?.email || 'Professional';
}

function buildProfessionalSummary(userId, userById, proByUserId, publicByUserId) {
  const user = userById.get(String(userId));
  if (!user || !isProfessionalRole(user.role)) return null;
  const pro = proByUserId.get(String(userId));
  const pub = publicByUserId.get(String(userId));
  return {
    id: String(userId),
    full_name: professionalDisplayName(user, pro),
    professional_type: pro?.professional_type || user.role || 'agent',
    company_name: pro?.company_name || '',
    profile_image: pub?.profile_photo_url || user.profile_image || null,
    location: pro?.location || '',
  };
}

function buildPropertySummary(matchFactors = {}, leadProfile = null) {
  const property = leadProfile?.property || {};
  return {
    id: matchFactors.inquired_property_id || null,
    title:
      matchFactors.inquired_property_title ||
      property.address ||
      property.location ||
      property.property_type ||
      'Property inquiry',
    location: property.location || property.address || '',
    price: property.expected_price || property.budget || '',
  };
}

export function dedupeInquiryItemsForAllView(items) {
  const propertyThreadIds = new Set(
    items
      .filter((item) => item.inquiry_type === 'property' && item.thread_id)
      .map((item) => String(item.thread_id)),
  );

  return items.filter((item) => {
    if (
      item.inquiry_type === 'professional' &&
      item.thread_id &&
      propertyThreadIds.has(String(item.thread_id))
    ) {
      return false;
    }
    return true;
  });
}

export function computeInquiryCounts(items) {
  return {
    total: dedupeInquiryItemsForAllView(items).length,
    property: items.filter((item) => item.inquiry_type === 'property').length,
    professional: items.filter((item) => item.inquiry_type === 'professional').length,
  };
}

function filterInquiriesByType(items, normalizedType) {
  if (normalizedType === 'property') {
    return items.filter((item) => item.inquiry_type === 'property');
  }
  if (normalizedType === 'professional') {
    return items.filter((item) => item.inquiry_type === 'professional');
  }
  return dedupeInquiryItemsForAllView(items);
}

export async function getClientInquiriesForUser(userId, { type = '', limit = 50, page = 1 } = {}) {
  const clientId = String(userId);
  const clientObjectId = toObjectId(userId);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const normalizedType = String(type || '').trim().toLowerCase();

  const threadParticipantFilter = clientObjectId
    ? {
        participants: clientObjectId,
        $or: [
          { thread_type: 'dm' },
          { thread_type: 'group', participants_key: /^lead:/ },
        ],
      }
    : {
        participants: userId,
        $or: [
          { thread_type: 'dm' },
          { thread_type: 'group', participants_key: /^lead:/ },
        ],
      };

  const [propertyMatches, clientProfiles, threads] = await Promise.all([
    LeadMatch.find({ 'compatibility_factors.client_user_id': clientId })
      .sort({ updatedAt: -1 })
      .lean(),
    LeadProfile.find({
      'ownership.user_id': userId,
      source: 'client_property_inquiry',
    })
      .sort({ updatedAt: -1 })
      .lean(),
    ProfessionalChatThread.find(threadParticipantFilter)
      .sort({ last_message_at: -1, updatedAt: -1 })
      .lean(),
  ]);

  const profileById = new Map(clientProfiles.map((profile) => [String(profile._id), profile]));
  const proUserIds = new Set();

  for (const match of propertyMatches) {
    if (match.user_id) proUserIds.add(String(match.user_id));
  }
  for (const thread of threads) {
    for (const participantId of thread.participants || []) {
      if (String(participantId) !== clientId) proUserIds.add(String(participantId));
    }
  }

  const proIds = [...proUserIds];
  const [users, proProfiles, publicProfiles] = proIds.length
    ? await Promise.all([
        User.find({ _id: { $in: proIds } }).select(USER_SELECT).lean(),
        ProfessionalProfile.find({ user_id: { $in: proIds } }).lean(),
        PublicProfile.find({ user_id: { $in: proIds } })
          .select('user_id profile_photo_url slug enabled')
          .lean(),
      ])
    : [[], [], []];

  const userById = new Map(users.map((user) => [String(user._id), user]));
  const proByUserId = new Map(proProfiles.map((profile) => [String(profile.user_id), profile]));
  const publicByUserId = new Map(publicProfiles.map((profile) => [String(profile.user_id), profile]));

  const items = [];
  const seenKeys = new Set();

  for (const match of propertyMatches) {
    const factors = match.compatibility_factors || {};
    const proUserId = String(match.user_id || '');
    const propertyId = factors.inquired_property_id ? String(factors.inquired_property_id) : '';
    const dedupeKey = `property:${propertyId || match.lead_profile_id}:${proUserId}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const professional = buildProfessionalSummary(proUserId, userById, proByUserId, publicByUserId);
    if (!professional) continue;

    const leadProfile = match.lead_profile_id ? profileById.get(String(match.lead_profile_id)) : null;

    items.push({
      id: String(match._id),
      inquiry_type: 'property',
      status: match.match_status || 'new',
      message: String(factors.inquiry_message || leadProfile?.property?.must_have_features || '').trim(),
      created_at: match.createdAt,
      updated_at: match.updatedAt || match.last_contact_at || match.createdAt,
      professional,
      property: buildPropertySummary(factors, leadProfile),
      thread_id: factors.chat_thread_id ? String(factors.chat_thread_id) : null,
      lead_match_id: String(match._id),
      lead_profile_id: match.lead_profile_id ? String(match.lead_profile_id) : null,
    });
  }

  for (const profile of clientProfiles) {
    const refs = Array.isArray(profile.lead_refs) ? profile.lead_refs.map(String) : [];
    const alreadyListed = items.some((item) => item.lead_profile_id === String(profile._id));
    if (alreadyListed) continue;

    const dedupeKey = `profile:${profile._id}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    items.push({
      id: String(profile._id),
      inquiry_type: 'property',
      status: profile.lifecycle?.status || 'new',
      message: String(profile.property?.must_have_features || '').trim(),
      created_at: profile.createdAt,
      updated_at: profile.updatedAt || profile.lifecycle?.last_inquiry_at || profile.createdAt,
      professional: null,
      property: buildPropertySummary({}, profile),
      thread_id: null,
      lead_match_id: refs[0] || null,
      lead_profile_id: String(profile._id),
    });
  }

  for (const thread of threads) {
    const otherParticipant = (thread.participants || []).find((participantId) => String(participantId) !== clientId);
    if (!otherParticipant) continue;

    const threadId = String(thread._id);
    const proUserId = String(otherParticipant);
    const professional = buildProfessionalSummary(proUserId, userById, proByUserId, publicByUserId);
    if (!professional) continue;

    const dedupeKey = `professional:${proUserId}:${threadId}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    items.push({
      id: threadId,
      inquiry_type: 'professional',
      status: thread.last_message_at ? 'active' : 'new',
      message: String(thread.last_message_text || '').trim(),
      created_at: thread.createdAt,
      updated_at: thread.last_message_at || thread.updatedAt || thread.createdAt,
      professional,
      property: null,
      thread_id: threadId,
      lead_match_id: null,
      lead_profile_id: null,
    });
  }

  items.sort(
    (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0),
  );

  const counts = computeInquiryCounts(items);
  const filtered = filterInquiriesByType(items, normalizedType);

  filtered.sort(
    (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0),
  );

  const total = filtered.length;
  const start = (safePage - 1) * safeLimit;
  const pagedItems = filtered.slice(start, start + safeLimit);

  return {
    items: pagedItems,
    counts,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      total_pages: Math.max(Math.ceil(total / safeLimit), 1),
      has_prev_page: safePage > 1,
      has_next_page: safePage * safeLimit < total,
    },
  };
}
