/**
 * Property Service - handles property listings for clients
 */
import LeadProfile from '../../models/LeadProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import ClientProfile from '../../models/ClientProfile.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import { USER_ROLE, isProfessionalRole } from '../../constants/roles.js';
import { createLeadLifecycleNotification } from '../notifications/notificationService.js';
import { createOrGetDirectThread } from '../proChat/threadService.js';
import { postThreadMessage } from '../proChat/messageService.js';
import { scoreLead } from '../chat/scoring/agentScoring.js';
import { buildLeadType } from '../chat/scoring/common.js';
import { normalizeInquiredProperty, resolveLinkedSellerLeadMatchId } from '../lead/inquiredProperty.js';

const USER_SELECT = 'first_name last_name email role profile_image phone';

function clientDisplayName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || 'Client';
}

function propertyTitle(property) {
  return (
    property?.property?.address ||
    property?.property?.location ||
    property?.property?.property_type ||
    'this property'
  );
}

function parsePrice(value) {
  const n = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function moneyString(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
}

function displayMoney(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : raw;
}

function normalizeAgentTimeline(value) {
  const current = String(value || '').trim();
  const legacyMap = {
    '1_year': '6-12 months',
    '2_years': 'browsing',
    '3_years': 'browsing',
    '5_years': 'browsing',
    exploring: 'browsing',
  };
  return legacyMap[current] || current;
}

function mapAgentTimelineToMortgage(value) {
  switch (normalizeAgentTimeline(value)) {
    case 'asap':
      return 'immediately';
    case '1-3 months':
      return '1_2_months';
    case '3-6 months':
      return '3_6_months';
    case '6-12 months':
      return '6_12_months';
    case 'browsing':
      return 'just_researching';
    default:
      return '';
  }
}

function mapAgentTimelineToLawyerClosing(value) {
  switch (normalizeAgentTimeline(value)) {
    case 'asap':
      return 'within_30_days';
    case '1-3 months':
      return '30_60_days';
    case '3-6 months':
      return '60_90_days';
    case '6-12 months':
    case 'browsing':
      return 'unknown';
    default:
      return '';
  }
}

function mapAgentMortgageToBroker(value) {
  switch (String(value || '').trim()) {
    case 'fully_pre_approved':
    case 'paying_cash':
      return 'already_approved';
    case 'in_progress':
      return 'in_progress';
    case 'not_yet':
      return 'need_now';
    default:
      return '';
  }
}

function buildPropertyInquiryChatBody({ property, inquiryText }) {
  const images = Array.isArray(property?.property?.images) ? property.property.images : [];
  const firstImage = images
    .map((image) => image?.secure_url || image?.url)
    .find(Boolean) || '';
  const card = {
    title: propertyTitle(property),
    location: property?.property?.location || '',
    price: displayMoney(property?.property?.expected_price || property?.property?.budget),
    propertyType: property?.property?.property_type || '',
    bedrooms: property?.property?.bedrooms || '',
    bathrooms: property?.property?.bathrooms || '',
    squareFootage: property?.property?.square_footage || '',
    features: property?.property?.must_have_features || '',
    listedDate: property?.createdAt || null,
    imageUrl: firstImage,
    imageCount: images.length,
  };
  return [
    '[PROPERTY_CARD]',
    JSON.stringify(card),
    '[/PROPERTY_CARD]',
    '',
    inquiryText,
  ].join('\n');
}

function buildLegacyPropertyInquiryChatBody({ property, inquiryText }) {
  const title = propertyTitle(property);
  const locationOrType = property?.property?.location || property?.property?.property_type || '';
  const price = displayMoney(property?.property?.expected_price || property?.property?.budget);
  const summary = [title, locationOrType, price].filter(Boolean).join(' • ');
  return [
    `I selected this property: ${summary}. Please guide me on the next steps.`,
    inquiryText,
  ].join('\n\n');
}

function buildClientProfileSnapshot(clientProfile) {
  if (!clientProfile) return null;
  return {
    annual_income: clientProfile.annual_income ?? null,
    employment_status: clientProfile.employment_status || '',
    current_savings: clientProfile.current_savings ?? null,
    monthly_savings: clientProfile.monthly_savings ?? null,
    dream_home_price: clientProfile.dream_home_price ?? null,
    purchase_timeline: clientProfile.purchase_timeline || '',
    preferred_location: clientProfile.preferred_location || '',
    mortgage_status: clientProfile.mortgage_status || '',
    realtor_status: clientProfile.realtor_status || '',
    viewing_readiness: clientProfile.viewing_readiness || '',
    offer_readiness: clientProfile.offer_readiness || '',
    motivation_reason: clientProfile.motivation_reason || '',
    living_situation: clientProfile.living_situation || '',
    purchase_purpose: clientProfile.purchase_purpose || '',
    preferred_contact_method: clientProfile.preferred_contact_method || '',
    best_time_to_contact: clientProfile.best_time_to_contact || '',
    down_payment_goal: clientProfile.down_payment_goal ?? null,
    homeownership_progress_score: clientProfile.homeownership_progress_score ?? null,
    months_to_goal: clientProfile.months_to_goal ?? null,
  };
}

async function buildListingProfessional(property) {
  const ownerId = property?.ownership?.user_id;
  if (!ownerId) return null;

  const [user, professionalProfile] = await Promise.all([
    User.findById(ownerId).select(USER_SELECT).lean(),
    ProfessionalProfile.findOne({ user_id: ownerId }).select('full_name professional_type company_name location').lean(),
  ]);

  if (!user) return null;
  const name =
    professionalProfile?.full_name ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    user.email ||
    'Listing professional';

  return {
    userId: String(user._id),
    name,
    role: user.role || professionalProfile?.professional_type || null,
    professionalType: professionalProfile?.professional_type || user.role || null,
    companyName: professionalProfile?.company_name || '',
    location: professionalProfile?.location || '',
    profileImage: user.profile_image || null,
  };
}

function formatProperty(property, listingProfessional = null) {
  return {
    id: property._id,
    address: property.property?.address || '',
    location: property.property?.location || '',
    price: property.property?.expected_price || property.property?.budget || '',
    bedrooms: property.property?.bedrooms || '',
    bathrooms: property.property?.bathrooms || '',
    squareFootage: property.property?.square_footage || '',
    propertyType: property.property?.property_type || '',
    images: property.property?.images || [],
    features: property.property?.must_have_features || '',
    parking: property.property?.parking_required || '',
    backyard: property.property?.backyard_needed || '',
    schoolDistrict: property.property?.school_district_important || '',
    timeline: property.property?.timeline || '',
    listedDate: property.createdAt,
    updatedDate: property.updatedAt,
    listingProfessional,
  };
}

async function loadAvailablePropertyById(id) {
  const property = await LeadProfile.findOne({
    _id: id,
    intent: 'sell',
    'lifecycle.status': { $nin: ['closed', 'sold', 'withdrawn'] },
  }).lean();

  if (!property) return null;

  const closedMatch = await LeadMatch.findOne({
    lead_profile_id: id,
    match_status: { $in: ['converted', 'closed_lost'] },
  }).select('_id').lean();

  return closedMatch ? null : property;
}

/**
 * Get available properties (seller leads) excluding closed ones
 */
export async function getAvailableProperties(req, res) {
  try {
    const { limit = 12, skip = 0, location, min_price, max_price, bedrooms, property_type } = req.query;

    // Find all seller leads (properties)
    const query = {
      intent: 'sell',
      'lifecycle.status': { $nin: ['closed', 'sold', 'withdrawn'] },
    };

    // Add filters if provided
    if (location) {
      query.$or = [
        { 'property.location': new RegExp(location, 'i') },
        { 'property.address': new RegExp(location, 'i') },
      ];
    }

    if (bedrooms) {
      query['property.bedrooms'] = bedrooms;
    }

    if (property_type) {
      query['property.property_type'] = new RegExp(property_type, 'i');
    }

    // Get seller leads
    let properties = await LeadProfile.find(query)
      .select('property identity lifecycle createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    // Get all lead match IDs for these properties to check if they're closed
    const propertyIds = properties.map(p => p._id);
    
    // Find all matches for these properties that are closed/converted
    const closedMatches = await LeadMatch.find({
      lead_profile_id: { $in: propertyIds },
      match_status: { $in: ['converted', 'closed_lost'] },
    }).select('lead_profile_id').lean();

    const closedPropertyIds = new Set(closedMatches.map(m => String(m.lead_profile_id)));

    // Filter out properties with closed matches
    properties = properties.filter(p => !closedPropertyIds.has(String(p._id)));

    // Apply price filtering if specified (after fetching, since it's stored as string)
    if (min_price || max_price) {
      properties = properties.filter(p => {
        const price = parseFloat(p.property?.expected_price?.replace(/[^0-9.]/g, '')) || 0;
        if (min_price && price < parseFloat(min_price)) return false;
        if (max_price && price > parseFloat(max_price)) return false;
        return true;
      });
    }

    // Get total count for pagination
    const total = await LeadProfile.countDocuments(query);

    // Format properties for client display
    const formattedProperties = properties.map(p => formatProperty(p));

    res.status(200).json({
      success: true,
      data: {
        properties: formattedProperties,
        pagination: {
          total,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + formattedProperties.length < total,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching available properties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available properties',
      error: error.message,
    });
  }
}

/**
 * Get property details by ID
 */
export async function getPropertyById(req, res) {
  try {
    const { id } = req.params;

    const property = await loadAvailablePropertyById(id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found or no longer available',
      });
    }

    const listingProfessional = await buildListingProfessional(property);

    res.status(200).json({
      success: true,
      data: formatProperty(property, listingProfessional),
    });
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch property details',
      error: error.message,
    });
  }
}

export async function createPropertyInquiry(req, res) {
  try {
    const clientUser = req.user;
    if (!clientUser || String(clientUser.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
      return res.status(403).json({ success: false, message: 'Only clients can inquire about properties' });
    }

    const { id } = req.params;
    const { message = '', contact_preference = '' } = req.body || {};
    const inquiryText = String(message || '').trim();
    if (!inquiryText) {
      return res.status(400).json({ success: false, message: 'Inquiry message is required' });
    }

    const property = await loadAvailablePropertyById(id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found or no longer available' });
    }

    const listingOwnerId = property?.ownership?.user_id;
    if (!listingOwnerId) {
      return res.status(400).json({ success: false, message: 'This property has no listing professional' });
    }

    const listingOwner = await User.findById(listingOwnerId).select(USER_SELECT).lean();
    if (!listingOwner || !isProfessionalRole(listingOwner.role)) {
      return res.status(400).json({ success: false, message: 'Listing professional is not available' });
    }

    if (String(listingOwner._id) === String(clientUser._id)) {
      return res.status(400).json({ success: false, message: 'Cannot inquire on your own listing' });
    }

    const [professionalProfile, clientProfile] = await Promise.all([
      ProfessionalProfile.findOne({ user_id: listingOwnerId }).select('_id professional_type').lean(),
      ClientProfile.findOne({ user_id: clientUser._id }).lean(),
    ]);
    const clientProfileSnapshot = buildClientProfileSnapshot(clientProfile);
    const clientName = clientDisplayName(clientUser);
    const title = propertyTitle(property);
    const listingFields = property.property || {};
    const listingProfessional = await buildListingProfessional(property);
    const sellerIdentity = property.identity || {};
    const inquiredPropertySnapshot = normalizeInquiredProperty({
      id: String(property._id),
      title,
      address: listingFields.address || '',
      location: listingFields.location || listingFields.address || '',
      expected_price: listingFields.expected_price || listingFields.budget || '',
      property_type: listingFields.property_type || '',
      bedrooms: listingFields.bedrooms,
      bathrooms: listingFields.bathrooms,
      square_footage: listingFields.square_footage,
      seller_name: sellerIdentity.full_name || '',
      seller_email: sellerIdentity.email || '',
      seller_phone: sellerIdentity.phone || '',
      listed_by_name: listingProfessional?.name || '',
      images: listingFields.images,
    });
    const linkedSellerLeadMatchId = await resolveLinkedSellerLeadMatchId({
      ownerUserId: listingOwnerId,
      inquiredProperty: inquiredPropertySnapshot,
    });
    const dedupeKey = `client_property_inquiry:${String(clientUser._id)}:${String(property._id)}`;
    const listingBudget = listingFields.expected_price || listingFields.budget || '';
    const listingLocation = listingFields.location || listingFields.address || '';
    const profileContactPreference = String(contact_preference || clientProfile?.preferred_contact_method || '').trim();
    const profileBestTimeToContact = clientProfile?.best_time_to_contact || '';
    const scoringMessage = [
      inquiryText,
      title,
      listingLocation,
      listingBudget,
      listingFields.property_type,
      listingFields.bedrooms != null && listingFields.bedrooms !== '' ? `${listingFields.bedrooms} bed` : '',
      listingFields.bathrooms != null && listingFields.bathrooms !== '' ? `${listingFields.bathrooms} bath` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const scoring = scoreLead({
      message: scoringMessage,
      hasContact: true,
      contactInfo: {
        name: clientName,
        email: clientUser.email || '',
        phone: clientUser.phone || '',
      },
      interactionCount: 1,
      seedSignals: {
        ...(listingBudget ? { budget: listingBudget } : {}),
        ...(listingLocation ? { location: listingLocation } : {}),
      },
      formQualification: {},
    });
    const leadScore = Number(scoring.leadScore || 0);
    const leadGrade = scoring.leadGrade || 'cold';
    const leadMeta = scoring.leadMeta || {};

    let inquiryProfile = await LeadProfile.findOne({ 'ownership.dedupe_key': dedupeKey });
    const profilePayload = {
      intent: 'buy',
      ownership: {
        user_id: clientUser._id,
        professional_type: professionalProfile?.professional_type || listingOwner.role || 'agent',
        dedupe_key: dedupeKey,
      },
      identity: {
        full_name: clientName,
        email: clientUser.email || '',
        phone: clientUser.phone || '',
        canonical_email: clientUser.email ? String(clientUser.email).trim().toLowerCase() : '',
        canonical_phone: clientUser.phone || '',
      },
      lifecycle: {
        status: 'new',
        first_seen_at: new Date(),
        last_seen_at: new Date(),
        last_inquiry_at: new Date(),
      },
      contact_preferences: {
        preferred_contact_method: profileContactPreference,
        best_time_to_contact: profileBestTimeToContact,
      },
      intent_summary: {
        primary_intent: 'buy',
        buy_count: 1,
        sell_count: 0,
        client_count: 1,
      },
      property: {
        address: listingFields.address || '',
        location: listingFields.location || listingFields.address || '',
        budget: listingFields.expected_price || listingFields.budget || '',
        expected_price: listingFields.expected_price || '',
        timeline: '',
        bedrooms: listingFields.bedrooms || '',
        bathrooms: listingFields.bathrooms || '',
        square_footage: listingFields.square_footage || '',
        property_type: listingFields.property_type || '',
        must_have_features: inquiryText,
      },
      qualification: {
        agent: {},
        mortgage_broker: {},
        lawyer: {
          transaction_stage: 'property_inquiry',
        },
      },
      source: 'client_property_inquiry',
      scoring: {
        current_score: leadScore,
        current_grade: leadGrade,
        score_trend: 'stable',
        last_scored_at: new Date(),
        components: leadMeta.sub_scores || {},
      },
      total_score: leadScore,
      stats: {
        total_inquiries: 1,
        total_sessions: 1,
        total_matches: 1,
        buy_matches: 1,
        sell_matches: 0,
        client_matches: 1,
        last_seen_at: new Date(),
      },
    };

    if (inquiryProfile) {
      inquiryProfile.set({
        identity: profilePayload.identity,
        lifecycle: {
          ...inquiryProfile.lifecycle,
          status: inquiryProfile.lifecycle?.status || 'new',
          last_seen_at: new Date(),
          last_inquiry_at: new Date(),
        },
        property: profilePayload.property,
        contact_preferences: profilePayload.contact_preferences,
        qualification: profilePayload.qualification,
        scoring: profilePayload.scoring,
        total_score: profilePayload.total_score,
        source: 'client_property_inquiry',
      });
      inquiryProfile.stats = {
        ...(inquiryProfile.stats?.toObject?.() || inquiryProfile.stats || {}),
        total_inquiries: Number(inquiryProfile.stats?.total_inquiries || 0) + 1,
        last_seen_at: new Date(),
      };
      await inquiryProfile.save();
    } else {
      inquiryProfile = await LeadProfile.create(profilePayload);
    }

    const threadResult = await createOrGetDirectThread({
      currentUserId: clientUser._id,
      otherUserId: listingOwnerId,
      allowClientProfessional: true,
    });
    const thread = threadResult?.body?.thread || null;
    if (thread?.id) {
      await postThreadMessage({
        currentUserId: clientUser._id,
        threadId: thread.id,
        body: buildPropertyInquiryChatBody({ property, inquiryText }),
        attachments: [],
        clientId: `property-inquiry:${String(property._id)}:${Date.now()}`,
      });
    }

    const matchPayload = {
      user_id: listingOwnerId,
      professional_profile_id: professionalProfile?._id || undefined,
      lead_type: buildLeadType(leadGrade, 'buy'),
      lead_profile_id: inquiryProfile._id,
      match_score: leadScore,
      match_status: 'new',
      compatibility_factors: {
        source: 'client_property_inquiry',
        professional_type: professionalProfile?.professional_type || listingOwner.role || 'agent',
        lead_grade: leadGrade,
        lead_reasons: leadMeta.lead_reasons || [],
        sub_scores: leadMeta.sub_scores || {},
        inquired_property: inquiredPropertySnapshot,
        linked_seller_lead_match_id: linkedSellerLeadMatchId || null,
        inquired_property_id: String(property._id),
        inquired_property_title: title,
        inquiry_message: inquiryText,
        contact_preference: profileContactPreference,
        best_time_to_contact: profileBestTimeToContact,
        client_user_id: String(clientUser._id),
        client_profile: clientProfileSnapshot,
        chat_thread_id: thread?.id || null,
      },
      last_contact_at: new Date(),
    };

    const leadMatch = await LeadMatch.findOneAndUpdate(
      {
        user_id: listingOwnerId,
        lead_profile_id: inquiryProfile._id,
        'compatibility_factors.inquired_property_id': String(property._id),
      },
      {
        $set: matchPayload,
        $setOnInsert: {
          first_contact_at: new Date(),
          contact_count: 0,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    await LeadProfile.updateOne(
      { _id: inquiryProfile._id },
      { $addToSet: { lead_refs: leadMatch._id } }
    );

    await createLeadLifecycleNotification(listingOwnerId, {
      notification_type: 'property_inquiry_created',
      title: 'New property inquiry',
      body: `${clientName} asked about ${title}.`,
      severity: 'high',
      lead_match_id: leadMatch._id,
      lead_profile_id: inquiryProfile._id,
      grade: leadGrade,
      score: leadMatch.match_score,
      intent: 'buy',
      action: {
        type: 'open_lead',
        lead_match_id: String(leadMatch._id),
        property_id: String(property._id),
        thread_id: thread?.id || null,
      },
      primary_next_action: {
        label: 'Review inquiry',
        href: `/leads/${String(leadMatch._id)}`,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Property inquiry sent',
      data: {
        property: formatProperty(property, await buildListingProfessional(property)),
        lead_match_id: String(leadMatch._id),
        lead_profile_id: String(inquiryProfile._id),
        thread,
      },
    });
  } catch (error) {
    console.error('Error creating property inquiry:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create property inquiry',
      error: error.message,
    });
  }
}

export async function createPropertyConversation(req, res) {
  try {
    const clientUser = req.user;
    if (!clientUser || String(clientUser.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
      return res.status(403).json({ success: false, message: 'Only clients can message listing professionals' });
    }

    const property = await loadAvailablePropertyById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found or no longer available' });
    }

    const listingOwnerId = property?.ownership?.user_id;
    if (!listingOwnerId) {
      return res.status(400).json({ success: false, message: 'This property has no listing professional' });
    }

    const listingOwner = await User.findById(listingOwnerId).select(USER_SELECT).lean();
    if (!listingOwner || !isProfessionalRole(listingOwner.role)) {
      return res.status(400).json({ success: false, message: 'Listing professional is not available' });
    }

    const threadResult = await createOrGetDirectThread({
      currentUserId: clientUser._id,
      otherUserId: listingOwnerId,
      allowClientProfessional: true,
    });

    return res.status(threadResult?.status || 200).json({
      ...(threadResult?.body || {}),
      property: formatProperty(property, await buildListingProfessional(property)),
    });
  } catch (error) {
    console.error('Error creating property conversation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start property conversation',
      error: error.message,
    });
  }
}

export async function notifyClientsOfNewPropertyForSale(leadProfileId) {
  const property = await loadAvailablePropertyById(leadProfileId);
  if (!property) return;

  const location = String(property.property?.location || property.property?.address || '').trim();
  const price = parsePrice(property.property?.expected_price || property.property?.budget);
  const query = {};

  if (location) {
    query.$or = [
      { preferred_location: { $regex: location.split(',')[0].trim(), $options: 'i' } },
      { preferred_location: '' },
      { preferred_location: { $exists: false } },
    ];
  }
  if (price) {
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { dream_home_price: { $gte: price * 0.85 } },
          { dream_home_price: null },
          { dream_home_price: { $exists: false } },
        ],
      },
    ];
  }

  const profiles = await ClientProfile.find(query).select('user_id').limit(50).lean();
  const title = propertyTitle(property);
  await Promise.all(
    profiles
      .filter((profile) => profile?.user_id)
      .map((profile) =>
        createLeadLifecycleNotification(profile.user_id, {
          notification_type: 'new_property_for_sale',
          title: 'New property for sale',
          body: `${title} is now available.`,
          severity: 'info',
          lead_profile_id: property._id,
          intent: 'sell',
          action: {
            type: 'open_property',
            property_id: String(property._id),
          },
          primary_next_action: {
            label: 'View property',
            href: `/client-dashboard/properties/${String(property._id)}`,
          },
        })
      )
  );
}
