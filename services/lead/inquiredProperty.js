import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';

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
