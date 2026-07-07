import LeadProfile from '../../models/LeadProfile.js';
import ClientProfile from '../../models/ClientProfile.js';
import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { USER_ROLE } from '../../constants/roles.js';
import { emitLeadLifecycleNotification } from '../realtime/leadCreatedNotify.js';
import { locationMatchScore } from '../matching/matchScoringUtils.js';
import logger from '../../utils/logger.js';

function displayMoney(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : raw;
}

function firstImageUrl(images) {
  const first = Array.isArray(images)
    ? images.find((img) => img?.secure_url || img?.url)
    : null;
  return first?.secure_url || first?.url || null;
}

function buildPropertySpecs(prop = {}) {
  const parts = [];
  const beds = String(prop.bedrooms || '').trim();
  const baths = String(prop.bathrooms || '').trim();
  const type = String(prop.property_type || '').trim();
  const sqft = String(prop.square_footage || '').trim();
  if (beds) parts.push(`${beds} bed${beds === '1' ? '' : 's'}`);
  if (baths) parts.push(`${baths} bath${baths === '1' ? '' : 's'}`);
  if (type) parts.push(type);
  if (sqft) parts.push(`${sqft} sq ft`);
  return parts.join(' · ');
}

async function loadListingAgent(property) {
  const ownerId = property?.ownership?.user_id;
  if (!ownerId) return null;

  const [user, professionalProfile] = await Promise.all([
    User.findById(ownerId).select('first_name last_name email profile_image').lean(),
    ProfessionalProfile.findOne({ user_id: ownerId })
      .select('full_name company_name location professional_type')
      .lean(),
  ]);
  if (!user) return null;

  const name =
    professionalProfile?.full_name ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    user.email ||
    'Listing agent';

  return {
    name,
    companyName: professionalProfile?.company_name || '',
    profileImage: user.profile_image || null,
  };
}

function buildPropertyNotificationContent(property, listingAgent) {
  const prop = property?.property || {};
  const address = String(prop.address || '').trim();
  const location = String(prop.location || '').trim();
  const headlineLocation = (location || address).split(',')[0].trim();
  const title = headlineLocation
    ? `New listing in ${headlineLocation.charAt(0).toUpperCase()}${headlineLocation.slice(1)}`
    : 'New property for sale';

  const priceDisplay = displayMoney(prop.expected_price || prop.budget);
  const specs = buildPropertySpecs(prop);
  const agentName = listingAgent?.name || '';
  const agentCompany = listingAgent?.companyName || '';

  const lines = [];
  if (address || location) {
    lines.push(`${address || location} is now available on Nesti.`);
  } else {
    lines.push('A new property matching your search area is now available on Nesti.');
  }

  const detailParts = [];
  if (specs) detailParts.push(specs);
  if (priceDisplay) detailParts.push(`Asking price: ${priceDisplay}`);
  if (prop.timeline) detailParts.push(`Timeline: ${String(prop.timeline).trim()}`);
  if (detailParts.length) {
    lines.push('', detailParts.join(' · '));
  }

  if (agentName) {
    lines.push('', agentCompany ? `Listed by ${agentName} · ${agentCompany}` : `Listed by ${agentName}`);
  }
  lines.push('', 'View photos and send an inquiry from the property page.');

  const propertyPreview = {
    address,
    location,
    price: priceDisplay,
    bedrooms: String(prop.bedrooms || '').trim(),
    bathrooms: String(prop.bathrooms || '').trim(),
    square_footage: String(prop.square_footage || '').trim(),
    property_type: String(prop.property_type || '').trim(),
    timeline: String(prop.timeline || '').trim(),
    image_url: firstImageUrl(prop.images),
    listing_agent: agentName
      ? {
          name: agentName,
          company: agentCompany,
          profile_image: listingAgent?.profileImage || null,
        }
      : null,
  };

  return {
    title,
    body: lines.join('\n'),
    outcomes_headline: [specs, priceDisplay].filter(Boolean).join(' — ') || null,
    property_preview: propertyPreview,
  };
}

function parsePrice(value) {
  const n = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function loadNotifiablePropertyById(id) {
  return LeadProfile.findOne({
    _id: id,
    intent: 'sell',
    'lifecycle.status': { $nin: ['closed', 'sold', 'withdrawn'] },
  }).lean();
}

function collectClientPreferredLocations(client = {}) {
  const locations = [
    ...(Array.isArray(client.preferred_locations) ? client.preferred_locations : []),
    client.preferred_location,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return [...new Set(locations)];
}

function clientMatchesListingLocation(client, listingText) {
  const preferred = collectClientPreferredLocations(client);
  if (!preferred.length) return true;
  const listing = String(listingText || '').trim();
  if (!listing) return true;
  const score = locationMatchScore(preferred, listing);
  return score == null || score > 0;
}

function clientMatchesListingBudget(client, listingPrice) {
  if (!listingPrice) return true;
  const budget = client.dream_home_price;
  if (budget == null || budget === '') return true;
  const n = Number(budget);
  if (!Number.isFinite(n) || n <= 0) return true;
  return n >= listingPrice * 0.7;
}

async function findClientsToNotify(property) {
  const listingText = [
    property?.property?.location,
    property?.property?.address,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(', ');
  const listingPrice = parsePrice(property?.property?.expected_price || property?.property?.budget);

  const profiles = await ClientProfile.find({})
    .select('user_id preferred_location preferred_locations dream_home_price')
    .lean();
  if (!profiles.length) return [];

  const clientUsers = await User.find({
    _id: { $in: profiles.map((profile) => profile.user_id).filter(Boolean) },
    role: USER_ROLE.CLIENT,
  })
    .select('_id')
    .lean();
  const clientUserIds = new Set(clientUsers.map((user) => String(user._id)));

  return profiles
    .filter((profile) => profile?.user_id && clientUserIds.has(String(profile.user_id)))
    .filter((profile) => clientMatchesListingLocation(profile, listingText))
    .filter((profile) => clientMatchesListingBudget(profile, listingPrice))
    .slice(0, 100);
}

export async function notifyClientsOfNewPropertyForSale(leadProfileId) {
  const property = await loadNotifiablePropertyById(leadProfileId);
  if (!property) {
    logger.info('New property client notification skipped (listing unavailable)', {
      lead_profile_id: String(leadProfileId),
    });
    return;
  }

  const profiles = await findClientsToNotify(property);
  if (!profiles.length) {
    logger.info('New property client notification skipped (no matching clients)', {
      lead_profile_id: String(property._id),
      location: property.property?.location || property.property?.address || null,
    });
    return;
  }

  const listingAgent = await loadListingAgent(property);
  const content = buildPropertyNotificationContent(property, listingAgent);

  await Promise.all(
    profiles.map((profile) =>
      emitLeadLifecycleNotification(profile.user_id, {
        notification_type: 'new_property_for_sale',
        title: content.title,
        body: content.body,
        severity: 'info',
        lead_profile_id: String(property._id),
        outcomes_headline: content.outcomes_headline,
        action: {
          type: 'open_property',
          property_id: String(property._id),
          property_preview: content.property_preview,
        },
        primary_next_action: {
          label: 'View property',
          href: `/client-dashboard/properties/${String(property._id)}`,
        },
      })
    )
  );

  logger.info('New property client notifications sent', {
    lead_profile_id: String(property._id),
    recipient_count: profiles.length,
  });
}
