import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import { LEAD_LIST_CONVERSATION_FIELDS } from './leadAppointmentStatus.js';
import { leadMapperOptsFromRequest } from './leadQueryUtils.js';
import { mapLeadMatchToSellerLeadSummary } from './leadResponseMappers.js';

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

export async function buildInquiredPropertyPayload(req, leadMatch) {
  const { inquiredProperty, linkedSellerLeadMatchId } = extractInquiredPropertyContext(leadMatch);
  if (!inquiredProperty && !linkedSellerLeadMatchId) {
    return {
      inquired_property: null,
      linked_seller_lead_match_id: null,
      seller_lead: null,
    };
  }
  const sellerLead = await fetchInquiredPropertySellerLead({
    linkedSellerLeadMatchId,
    mapperOpts: leadMapperOptsFromRequest(req),
  });
  return {
    inquired_property: inquiredProperty,
    linked_seller_lead_match_id: linkedSellerLeadMatchId || null,
    seller_lead: sellerLead,
  };
}
