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
  const propertyType = String(matchFactors.property_type || property.property_type || '').trim();
  return {
    id: matchFactors.inquired_property_id || null,
    title:
      matchFactors.inquired_property_title ||
      property.address ||
      property.location ||
      propertyType ||
      'Property inquiry',
    location: property.location || property.address || '',
    price: property.expected_price || property.budget || '',
    property_type: propertyType || '',
  };
}

function matchInquirySource(match = {}, leadProfile = null) {
  return String(
    match?.compatibility_factors?.source ||
      leadProfile?.source ||
      '',
  )
    .trim()
    .toLowerCase();
}

/** True only for listing/property inquiries — not lawyer/professional profile inquiries. */
export function isPropertyInquiryMatch(match = {}, leadProfile = null) {
  const factors = match?.compatibility_factors || {};
  const source = matchInquirySource(match, leadProfile);
  if (source === 'client_professional_inquiry') return false;
  if (source === 'client_property_inquiry') return true;
  if (factors.inquired_property_id) return true;
  return false;
}

const LEGAL_SERVICE_LABELS = {
  full_closing: 'Full closing services',
  purchase_closing: 'Purchase closing',
  sale_closing: 'Sale closing',
  refinance_legal_work: 'Refinance legal work',
  agreement_review: 'Agreement / contract review',
  title_transfer: 'Title transfer',
  document_review: 'Document review',
  mortgage_document_review: 'Mortgage document review',
  property_dispute_advice: 'Property dispute / legal advice',
  other: 'Other legal service',
};

export function legalServiceLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return '';
  if (LEGAL_SERVICE_LABELS[key]) return LEGAL_SERVICE_LABELS[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveLegalServicesNeeded(match = {}) {
  // Only use per-match factors. Never fall back to LeadProfile qualification —
  // lawyer inquiries for the same client+lawyer share one profile that is
  // overwritten by the latest submission, which would rewrite every row's title.
  return String(match?.compatibility_factors?.legal_services_needed || '').trim();
}

export function resolveMortgageServiceLabel(match = {}) {
  const factors = match?.compatibility_factors || {};
  const purpose = String(factors.purchase_purpose || '').trim();
  if (purpose === 'primary_residence') return 'Primary residence';
  if (purpose === 'investment') return 'Investment property';
  if (purpose === 'refinance') return 'Refinance';
  if (purpose === 'vacation_home') return 'Vacation / second home';
  const explicit = String(factors.mortgage_service_label || '').trim();
  if (explicit) return explicit;
  if (String(factors.pre_approval_status || '').trim() === 'need_now') return 'Pre-approval guidance';
  return '';
}

export function resolveAgentServiceLabel(match = {}) {
  const factors = match?.compatibility_factors || {};
  const explicit = String(factors.agent_service_label || '').trim();
  if (explicit) return explicit;
  const intent = String(factors.intent || '').trim();
  if (intent === 'buy') return 'Buying help';
  if (intent === 'sell') return 'Selling help';
  const goal = String(factors.inquiry_goal || '').trim();
  if (goal === 'buying_help') return 'Buying help';
  if (goal === 'selling_help') return 'Selling help';
  if (goal === 'home_valuation') return 'Home valuation';
  if (goal === 'showings') return 'Showings / tours';
  if (goal === 'market_advice') return 'Market advice';
  return '';
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

function normalizeProfessionalRole(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'lawyer') return 'lawyer';
  if (key === 'mortgage_broker' || key === 'broker') return 'broker';
  if (key === 'agent') return 'agent';
  return key || 'agent';
}

export function computeInquiryCounts(items) {
  const list = Array.isArray(items) ? items : [];
  const propertyItems = list.filter((item) => item.inquiry_type === 'property');
  const professionalItems = list.filter((item) => item.inquiry_type === 'professional');
  const deduped = dedupeInquiryItemsForAllView(list);

  let agents = 0;
  let lawyers = 0;
  let brokers = 0;

  // Property inquiries belong to agents. Count from the same deduped list as Total
  // so Agents + Lawyers + Brokers matches Total.
  for (const item of deduped) {
    if (item.inquiry_type === 'property') {
      agents += 1;
      continue;
    }
    const role = normalizeProfessionalRole(item?.professional?.professional_type);
    if (role === 'lawyer') lawyers += 1;
    else if (role === 'broker') brokers += 1;
    else agents += 1;
  }

  return {
    total: deduped.length,
    property: propertyItems.length,
    professional: professionalItems.length,
    agents,
    lawyers,
    brokers,
  };
}

function inquiryRoleBucket(item) {
  if (item?.inquiry_type === 'property') return 'agent';
  return normalizeProfessionalRole(item?.professional?.professional_type);
}

function filterInquiriesByType(items, normalizedType) {
  const list = Array.isArray(items) ? items : [];
  if (normalizedType === 'property') {
    return list.filter((item) => item.inquiry_type === 'property');
  }
  if (normalizedType === 'professional') {
    return list.filter((item) => item.inquiry_type === 'professional');
  }
  if (normalizedType === 'agent' || normalizedType === 'lawyer' || normalizedType === 'broker') {
    return dedupeInquiryItemsForAllView(list).filter((item) => inquiryRoleBucket(item) === normalizedType);
  }
  return dedupeInquiryItemsForAllView(list);
}

export async function getClientInquiriesForUser(userId, { type = '', limit = 50, page = 1, threadId = '' } = {}) {
  const clientId = String(userId);
  const clientObjectId = toObjectId(userId);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const normalizedType = String(type || '').trim().toLowerCase();
  const targetThreadId = String(threadId || '').trim();

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

  const [clientMatches, clientProfiles, threads] = await Promise.all([
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

  const matchProfileIds = clientMatches
    .map((match) => match.lead_profile_id)
    .filter(Boolean);
  const matchProfiles = matchProfileIds.length
    ? await LeadProfile.find({ _id: { $in: matchProfileIds } }).lean()
    : [];

  const profileById = new Map([
    ...clientProfiles.map((profile) => [String(profile._id), profile]),
    ...matchProfiles.map((profile) => [String(profile._id), profile]),
  ]);
  const proUserIds = new Set();

  for (const match of clientMatches) {
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
  const seenThreadIds = new Set();
  const threadById = new Map(threads.map((thread) => [String(thread._id), thread]));

  for (const match of clientMatches) {
    const factors = match.compatibility_factors || {};
    const proUserId = String(match.user_id || '');
    const leadProfile = match.lead_profile_id ? profileById.get(String(match.lead_profile_id)) : null;
    const isProperty = isPropertyInquiryMatch(match, leadProfile);
    const propertyId = factors.inquired_property_id ? String(factors.inquired_property_id) : '';
    // Keep every distinct match/thread. Only collapse exact same property+pro or same match id.
    const dedupeKey = isProperty
      ? `property:${propertyId || match.lead_profile_id}:${proUserId}`
      : `professional-match:${String(match._id)}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const professional = buildProfessionalSummary(proUserId, userById, proByUserId, publicByUserId);
    if (!professional) continue;

    const threadId = factors.chat_thread_id ? String(factors.chat_thread_id) : null;
    const thread = threadId ? threadById.get(threadId) : null;
    if (threadId) seenThreadIds.add(threadId);

    const legalServicesNeeded = isProperty ? '' : resolveLegalServicesNeeded(match);
    const mortgageServiceLabel = isProperty ? '' : resolveMortgageServiceLabel(match);
    const agentServiceLabel = isProperty ? '' : resolveAgentServiceLabel(match);
    const propertyType = String(factors.property_type || leadProfile?.property?.property_type || '').trim();
    // Prefer this match's own inquiry message — never the shared profile's latest message.
    const matchMessage = String(factors.inquiry_message || '').trim();
    const lastMessage = String(thread?.last_message_text || '').trim();

    items.push({
      id: String(match._id),
      inquiry_type: isProperty ? 'property' : 'professional',
      status: match.match_status || 'new',
      message: lastMessage || matchMessage || (isProperty ? String(leadProfile?.property?.must_have_features || '').trim() : ''),
      last_message_text: lastMessage || null,
      initial_inquiry_message: matchMessage || null,
      created_at: match.createdAt,
      updated_at: thread?.last_message_at || thread?.updatedAt || match.updatedAt || match.last_contact_at || match.createdAt,
      professional,
      property: isProperty ? buildPropertySummary(factors, leadProfile) : null,
      legal_services_needed: legalServicesNeeded || null,
      legal_service_label: legalServicesNeeded ? legalServiceLabel(legalServicesNeeded) : null,
      mortgage_service_label: mortgageServiceLabel || null,
      agent_service_label: agentServiceLabel || null,
      property_type: propertyType || null,
      thread_id: threadId,
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
      legal_services_needed: null,
      legal_service_label: null,
      mortgage_service_label: null,
      agent_service_label: null,
      thread_id: null,
      lead_match_id: refs[0] || null,
      lead_profile_id: String(profile._id),
    });
  }

  for (const thread of threads) {
    const otherParticipant = (thread.participants || []).find((participantId) => String(participantId) !== clientId);
    if (!otherParticipant) continue;

    const threadId = String(thread._id);
    // Only skip a thread if it is already represented by a LeadMatch chat_thread_id.
    if (seenThreadIds.has(threadId)) continue;

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
      legal_services_needed: null,
      legal_service_label: null,
      mortgage_service_label: null,
      agent_service_label: null,
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
  let effectivePage = safePage;
  if (targetThreadId) {
    const targetIndex = filtered.findIndex((item) => String(item?.thread_id || '').trim() === targetThreadId);
    if (targetIndex >= 0) {
      effectivePage = Math.floor(targetIndex / safeLimit) + 1;
    }
  }
  const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
  effectivePage = Math.min(effectivePage, totalPages);
  const start = (effectivePage - 1) * safeLimit;
  const pagedItems = filtered.slice(start, start + safeLimit);

  return {
    items: pagedItems,
    counts,
    pagination: {
      page: effectivePage,
      limit: safeLimit,
      total,
      total_pages: totalPages,
      has_prev_page: effectivePage > 1,
      has_next_page: effectivePage * safeLimit < total,
    },
  };
}
