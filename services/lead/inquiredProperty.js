import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import { LEAD_LIST_CONVERSATION_FIELDS } from './leadAppointmentStatus.js';
import { leadMapperOptsFromRequest } from './leadQueryUtils.js';
import { mapLeadMatchToSellerLeadSummary } from './leadResponseMappers.js';
import { mapLeadProfileForApi } from './leadProfileFormat.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

const INQUIRED_PROPERTY_LEAD_MATCH_FIELDS =
  '_id lead_profile_id conversation_id match_score match_status compatibility_factors lead_type createdAt updatedAt';
const INQUIRED_PROPERTY_PROFILE_FIELDS =
  'intent identity contact_preferences property qualification ownership createdAt updatedAt';

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeImageUrls(input) {
  return (Array.isArray(input) ? input : [])
    .map((img) => (typeof img === 'string' ? img : img?.secure_url || img?.url || ''))
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** Read stored inquiry context from a LeadMatch row. */
export function extractInquiredPropertyContext(leadMatch) {
  const cf = leadMatch?.compatibility_factors || {};
  const inquiredProperty =
    cf.inquired_property && typeof cf.inquired_property === 'object'
      ? cf.inquired_property
      : null;
  const linkedSellerLeadMatchId = String(cf.linked_seller_lead_match_id || '').trim();
  return { inquiredProperty, linkedSellerLeadMatchId };
}

export function normalizeInquiredProperty(input, { fromPropertyMatch = false } = {}) {
  if (!input || typeof input !== 'object') return null;
  const matchedContact = input.matched_contact && typeof input.matched_contact === 'object'
    ? input.matched_contact
    : {};
  const imageInputs = fromPropertyMatch
    ? [input.image_url, ...(Array.isArray(input.images) ? input.images : [])]
    : input.images;
  const normalized = {
    id: firstString(input.lead_profile_id, input.id).replace(/^lead:/, '') || null,
    title: firstString(input.title) || null,
    address: firstString(input.address),
    location: firstString(input.location, input.address),
    expected_price: firstString(input.expected_price, input.price),
    property_type: firstString(input.property_type),
    bedrooms: input.bedrooms != null ? String(input.bedrooms).trim() : '',
    bathrooms: input.bathrooms != null ? String(input.bathrooms).trim() : '',
    square_footage: input.square_footage != null ? String(input.square_footage).trim() : '',
    seller_name: firstString(input.seller_name, matchedContact.full_name),
    seller_email: firstString(input.seller_email, matchedContact.email),
    seller_phone: firstString(input.seller_phone, matchedContact.phone),
    listed_by_name: firstString(input.listed_by_name),
    images: normalizeImageUrls(imageInputs),
  };
  const hasAnyData = Object.values(normalized).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value != null && String(value).trim() !== '';
  });
  return hasAnyData ? normalized : null;
}

export async function resolveLinkedSellerLeadMatchId({ ownerUserId, inquiredProperty, selectedProperty = null }) {
  const profileId = firstString(
    selectedProperty?.lead_profile_id,
    selectedProperty?.id,
    inquiredProperty?.id,
  ).replace(/^lead:/, '');
  if (!profileId || !mongoose.Types.ObjectId.isValid(profileId)) return null;
  const sellerLeadMatch = await LeadMatch.findOne({
    user_id: ownerUserId,
    lead_profile_id: new mongoose.Types.ObjectId(profileId),
    lead_type: /seller/i,
  })
    .select('_id')
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
  return sellerLeadMatch?._id ? String(sellerLeadMatch._id) : null;
}

export async function fetchInquiredPropertySellerLead({ linkedSellerLeadMatchId, mapperOpts }) {
  if (!linkedSellerLeadMatchId || !mongoose.Types.ObjectId.isValid(linkedSellerLeadMatchId)) return null;
  const sellerMatch = await LeadMatch.findById(linkedSellerLeadMatchId)
    .select(INQUIRED_PROPERTY_LEAD_MATCH_FIELDS)
    .lean();
  if (!sellerMatch) return null;

  const [profile, convo] = await Promise.all([
    sellerMatch.lead_profile_id
      ? LeadProfile.findById(sellerMatch.lead_profile_id).select(INQUIRED_PROPERTY_PROFILE_FIELDS).lean()
      : null,
    sellerMatch.conversation_id
      ? ChatConversation.findById(sellerMatch.conversation_id).select(LEAD_LIST_CONVERSATION_FIELDS).lean()
      : null,
  ]);

  return mapLeadMatchToSellerLeadSummary(sellerMatch, profile, convo || {}, mapperOpts);
}

function mapSellerListingProfileToLeadSummary(profile) {
  if (!profile || profile.intent !== 'sell') return null;
  const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile, profType);
  const grade = String(profile?.scoring?.current_grade || 'warm').toLowerCase();
  return {
    id: null,
    professional_type: profType,
    lead_type: `${grade}_seller`,
    grade,
    score: profile.total_score ?? profile?.scoring?.current_score ?? null,
    status: profile.lifecycle?.status || 'new',
    contact: profileView.contact,
    property: profileView.property,
    qualification: profileView.qualification,
    appointment_status: 'none',
    calendly_booking_status: null,
    conversation_id: '',
    source: 'property_listing',
    intent: 'sell',
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

export async function fetchInquiredPropertySellerLeadWithFallback({
  linkedSellerLeadMatchId,
  ownerUserId,
  profileId,
  mapperOpts,
}) {
  let resolvedMatchId = String(linkedSellerLeadMatchId || '').trim();
  const normalizedProfileId = firstString(profileId).replace(/^lead:/, '');

  if (!resolvedMatchId && normalizedProfileId && ownerUserId) {
    resolvedMatchId =
      (await resolveLinkedSellerLeadMatchId({
        ownerUserId,
        inquiredProperty: { id: normalizedProfileId },
      })) || '';
  }

  if (resolvedMatchId) {
    const sellerLead = await fetchInquiredPropertySellerLead({
      linkedSellerLeadMatchId: resolvedMatchId,
      mapperOpts,
    });
    if (sellerLead) return { sellerLead, linkedSellerLeadMatchId: resolvedMatchId };
  }

  if (!normalizedProfileId || !mongoose.Types.ObjectId.isValid(normalizedProfileId)) {
    return { sellerLead: null, linkedSellerLeadMatchId: resolvedMatchId || null };
  }

  const profile = await LeadProfile.findById(normalizedProfileId)
    .select(INQUIRED_PROPERTY_PROFILE_FIELDS)
    .lean();
  return {
    sellerLead: mapSellerListingProfileToLeadSummary(profile),
    linkedSellerLeadMatchId: resolvedMatchId || null,
  };
}

export async function buildInquiredPropertyPayload(req, leadMatch) {
  const cf = leadMatch?.compatibility_factors || {};
  const { inquiredProperty, linkedSellerLeadMatchId: storedLinkedId } = extractInquiredPropertyContext(leadMatch);
  const profileId = firstString(inquiredProperty?.id, cf.inquired_property_id);

  if (!inquiredProperty && !storedLinkedId && !profileId) {
    return {
      inquired_property: null,
      linked_seller_lead_match_id: null,
      seller_lead: null,
    };
  }

  const { sellerLead, linkedSellerLeadMatchId } = await fetchInquiredPropertySellerLeadWithFallback({
    linkedSellerLeadMatchId: storedLinkedId,
    ownerUserId: leadMatch.user_id,
    profileId,
    mapperOpts: leadMapperOptsFromRequest(req),
  });

  return {
    inquired_property: inquiredProperty,
    linked_seller_lead_match_id: linkedSellerLeadMatchId || null,
    seller_lead: sellerLead,
  };
}
