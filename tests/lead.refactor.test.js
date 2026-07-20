import test from 'node:test';
import assert from 'node:assert/strict';

const ROUTE_HANDLERS = [
  'deleteLeadById',
  'getLeadById',
  'getLeadConversation',
  'getLeadInquiredProperty',
  'getLeadsByProfileId',
  'getLeadProfiles',
  'getLeadProfileById',
  'getLeads',
  'getLeadPropertyMatches',
  'recordLeadView',
  'updateLeadMatch',
];

const LEAD_MODULES = [
  '../services/lead/leadQueryUtils.js',
  '../services/lead/leadConversionChecklist.js',
  '../services/lead/leadResponseMappers.js',
  '../services/lead/leadProfileHelpers.js',
  '../services/lead/leadProfileSignals.js',
  '../services/lead/leadNurtureBookingStatus.js',
  '../services/lead/leadAppointmentStatus.js',
  '../services/lead/leadMatchFollowUpSync.js',
  '../services/lead/leadPropertyMatchHelpers.js',
  '../services/lead/inquiredProperty.js',
  '../services/lead/icpScoringService.js',
];

const stubMatch = {
  _id: '507f1f77bcf86cd799439011',
  lead_type: 'buyer_hot',
  match_score: 80,
  match_status: 'new',
  conversation_id: '507f1f77bcf86cd799439012',
  compatibility_factors: { source: 'widget', professional_type: 'agent' },
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
};

const stubProfile = {
  _id: '507f1f77bcf86cd799439013',
  intent: 'buy',
  identity: { full_name: 'Test User', email: 't@example.com', phone: '555' },
  contact_preferences: {},
  property: { location: 'Toronto', budget: '500k' },
  qualification: {},
  ownership: { professional_type: 'agent' },
};

const stubConvo = { calendly_booking_status: null, calendly_event_start: null, session_id: 's1' };

test('leadService exports all route handlers', async () => {
  const leadService = await import('../services/lead/leadService.js');
  for (const name of ROUTE_HANDLERS) {
    assert.equal(typeof leadService[name], 'function', `leadService.${name}`);
  }
});

test('lead modules import without error', async () => {
  for (const modPath of LEAD_MODULES) {
    await import(modPath);
  }
});

test('resolveListIntent prioritizes lead_type and inquiry_intent', async () => {
  const { resolveListIntent } = await import('../services/lead/leadQueryUtils.js');
  assert.equal(resolveListIntent({}, { lead_type: 'buyer_hot' }), 'buy');
  assert.equal(resolveListIntent({}, { lead_type: 'seller_warm' }), 'sell');
  assert.equal(
    resolveListIntent({}, { compatibility_factors: { inquiry_intent: 'buy' } }),
    'buy',
  );
  assert.equal(resolveListIntent({ intent: 'seller' }, { lead_type: 'other' }), 'sell');
});

test('normalizeProfileIdList filters invalid ids', async () => {
  const { normalizeProfileIdList } = await import('../services/lead/leadQueryUtils.js');
  assert.deepEqual(
    normalizeProfileIdList(['507f1f77bcf86cd799439011', 'bad', null]),
    ['507f1f77bcf86cd799439011'],
  );
});

test('buildLeadsListMatchFilter applies intent regex', async () => {
  const { buildLeadsListMatchFilter } = await import('../services/lead/leadQueryUtils.js');
  const buyFilter = buildLeadsListMatchFilter('uid', { intent: 'buy' });
  assert.match(String(buyFilter.lead_type), /buyer|client/);
  const sellFilter = buildLeadsListMatchFilter('uid', { intent: 'sell' });
  assert.match(String(sellFilter.lead_type), /seller/);
  const defaultFilter = buildLeadsListMatchFilter('uid', {});
  assert.deepEqual(defaultFilter.match_status, { $nin: ['converted', 'closed_lost'] });
  const convertedFilter = buildLeadsListMatchFilter('uid', { status: 'converted' });
  assert.equal(convertedFilter.match_status, 'converted');
});

test('mergeConvoWithWorkspaceBooking overlays workspace booking fields', async () => {
  const { mergeConvoWithWorkspaceBooking } = await import('../services/lead/leadAppointmentStatus.js');
  const bookedLeadIds = new Set(['abc']);
  const startByLeadId = new Map([['abc', '2026-12-01T10:00:00.000Z']]);
  const merged = mergeConvoWithWorkspaceBooking(
    {},
    'abc',
    null,
    bookedLeadIds,
    new Set(),
    startByLeadId,
    new Map(),
  );
  assert.equal(merged.calendly_booking_status, 'booked');
  assert.equal(merged.calendly_event_start, '2026-12-01T10:00:00.000Z');
});

test('lead response mappers preserve core list/detail/seller shapes', async () => {
  const {
    mapLeadMatchToListRow,
    mapLeadMatchToDetail,
    mapLeadMatchToSellerLeadSummary,
    mapLeadMatchUnderProfile,
  } = await import('../services/lead/leadResponseMappers.js');

  const listRow = mapLeadMatchToListRow(stubMatch, stubProfile, stubConvo, false, {
    includeIntentField: true,
    includeExperienceBlocks: false,
  });
  assert.equal(listRow.id, String(stubMatch._id));
  assert.equal(listRow.lead_type, 'buyer_hot');
  assert.equal(listRow.intent, 'buy');
  assert.equal(listRow.contact.full_name, 'Test User');
  assert.equal(listRow.conversionChecklist?.role, 'agent');
  assert.equal(listRow.conversionChecklist?.canConvert, false);

  const detail = mapLeadMatchToDetail(stubMatch, stubProfile, stubConvo, { includeIntentField: true });
  assert.equal(detail.id, listRow.id);
  assert.equal(detail.appointment_status, 'not_booked');
  assert.equal(detail.professional_type, 'agent');

  const sellerSummary = mapLeadMatchToSellerLeadSummary(stubMatch, stubProfile, stubConvo, {
    includeIntentField: true,
  });
  assert.equal(sellerSummary.id, listRow.id);
  assert.equal(sellerSummary.intent, 'buy');
  assert.equal(sellerSummary.source, 'widget');

  const underProfile = mapLeadMatchUnderProfile(stubMatch, stubProfile, stubConvo, {
    includeIntentField: true,
    includeExperienceBlocks: false,
  });
  assert.equal(underProfile.id, listRow.id);
  assert.equal(underProfile.professional_type, 'agent');
});

test('lawyer client professional inquiry list rows use per-match property_address for location', async () => {
  const { mapLeadMatchToListRow } = await import('../services/lead/leadResponseMappers.js');
  const sharedProfile = {
    _id: '507f1f77bcf86cd799439099',
    intent: 'unspecified',
    identity: { full_name: 'Muhamamd Ahmed', email: 'client@example.com', phone: '555' },
    contact_preferences: {},
    property: { location: 'rtyuio', address: 'rtyuio' },
    qualification: { lawyer: { legal_services_needed: 'sale_closing' } },
    ownership: { professional_type: 'lawyer' },
    source: 'client_professional_inquiry',
  };

  const olderMatch = {
    ...stubMatch,
    _id: '507f1f77bcf86cd799439021',
    lead_type: 'client_warm',
    compatibility_factors: {
      source: 'client_professional_inquiry',
      professional_type: 'lawyer',
      property_address: 'Johar Town, Lahore',
    },
  };
  const newerMatch = {
    ...stubMatch,
    _id: '507f1f77bcf86cd799439022',
    lead_type: 'client_hot',
    compatibility_factors: {
      source: 'client_professional_inquiry',
      professional_type: 'lawyer',
      property_address: 'DHA Phase 5',
    },
  };

  const olderRow = mapLeadMatchToListRow(olderMatch, sharedProfile, stubConvo, false, {
    includeIntentField: false,
    includeExperienceBlocks: false,
  });
  const newerRow = mapLeadMatchToListRow(newerMatch, sharedProfile, stubConvo, false, {
    includeIntentField: false,
    includeExperienceBlocks: false,
  });

  assert.equal(olderRow.location, 'Johar Town, Lahore');
  assert.equal(olderRow.property.location, 'Johar Town, Lahore');
  assert.equal(newerRow.location, 'DHA Phase 5');
  assert.equal(newerRow.property.location, 'DHA Phase 5');
});

test('role conversion checklist matches role-specific requirements', async () => {
  const { evaluateRoleConversionChecklist } = await import(
    '../services/lead/leadConversionChecklist.js'
  );

  const baseLead = {
    compatibility_factors: { professional_type: 'mortgage_broker' },
  };
  const incompleteMortgage = evaluateRoleConversionChecklist({
    role: 'mortgage_broker',
    leadMatch: baseLead,
    leadProfile: {
      property: { budget: '' },
      qualification: { mortgage_broker: { pre_approval_status: '', mortgage_timeline: '' } },
    },
  });
  assert.equal(incompleteMortgage.canConvert, false);
  assert.ok(incompleteMortgage.missingItems.length >= 1);

  const completeAgent = evaluateRoleConversionChecklist({
    role: 'agent',
    leadMatch: {
      compatibility_factors: {
        professional_type: 'agent',
        agent_notes: [{ text: 'next step submit offer' }],
      },
    },
    leadProfile: {
      property: {
        address: '123 Main St',
        budget: '850000',
        timeline: '2 months',
      },
      qualification: {
        agent: {
          urgency_readiness: 'yes_immediately',
          mortgage_status: 'fully_pre_approved',
        },
      },
      budget_profile: {},
    },
  });
  assert.equal(completeAgent.canConvert, true);
  assert.equal(completeAgent.missingItems.length, 0);

  const completeLawyer = evaluateRoleConversionChecklist({
    role: 'lawyer',
    leadMatch: {
      compatibility_factors: {
        professional_type: 'lawyer',
        agent_notes: [{ text: 'next step prepare closing package' }],
      },
    },
    leadProfile: {
      property: {
        address: '12 King St',
        timeline: '30_60_days',
      },
      qualification: {
        lawyer: {
          transaction_type: 'home_purchase',
          closing_timeline: '30_60_days',
          transaction_stage: 'offer_accepted',
          legal_services_needed: 'full_closing',
        },
      },
    },
  });
  assert.equal(completeLawyer.canConvert, true);
});

test('inquired property helpers normalize context and payload fields', async () => {
  const { extractInquiredPropertyContext, normalizeInquiredProperty } = await import(
    '../services/lead/inquiredProperty.js'
  );
  const ctx = extractInquiredPropertyContext({
    compatibility_factors: {
      inquired_property: { title: 'Home' },
      linked_seller_lead_match_id: '507f1f77bcf86cd799439014',
    },
  });
  assert.equal(ctx.inquiredProperty.title, 'Home');
  assert.equal(ctx.linkedSellerLeadMatchId, '507f1f77bcf86cd799439014');

  const normalized = normalizeInquiredProperty({ title: '  Condo  ', address: 'Main St' });
  assert.equal(normalized.title, 'Condo');
  assert.equal(normalized.address, 'Main St');

  const deduped = normalizeInquiredProperty({
    title: 'Duplex',
    address: 'Duplex',
    images: ['https://cdn/a.jpg', 'https://cdn/a.jpg', 'https://cdn/b.jpg'],
  });
  assert.deepEqual(deduped.images, ['https://cdn/a.jpg', 'https://cdn/b.jpg']);

  const cloudinaryDeduped = normalizeInquiredProperty({
    title: 'Home',
    images: [
      { public_id: 'listings/photo-1', secure_url: 'https://res.cloudinary.com/demo/image/upload/w_400/v1/listings/photo-1.jpg' },
      { public_id: 'listings/photo-1', secure_url: 'https://res.cloudinary.com/demo/image/upload/w_800/v1/listings/photo-1.jpg' },
      { public_id: 'listings/photo-2', url: 'https://res.cloudinary.com/demo/image/upload/v1/listings/photo-2.jpg' },
    ],
  });
  assert.equal(cloudinaryDeduped.images.length, 2);
});

test('client property inquiry scoring uses scoreLead with client profile signals', async () => {
  const {
    scoreClientPropertyInquiry,
    scoreLead,
  } = await import('../services/chat/scoring/agentScoring.js');

  const bare = scoreLead({
    message: 'Hi lahore 500000',
    hasContact: true,
    contactInfo: { name: 'Test', email: 't@example.com', phone: '' },
    interactionCount: 1,
    seedSignals: { budget: '500000', location: 'lahore' },
    formQualification: {},
  });
  assert.equal(bare.leadScore, 19);
  assert.equal(bare.leadGrade, 'cold');

  const inquiry = scoreClientPropertyInquiry({
    inquiryText: 'I am interested in this home',
    listingFields: {
      address: 'lahore',
      location: 'lahore',
      expected_price: '500000',
      property_type: 'Condo',
      bedrooms: '3',
      bathrooms: '3',
    },
    clientName: 'Muhamamd Ahmed',
    clientEmail: 'client@example.com',
    clientPhone: '',
  });
  assert.equal(inquiry.leadScore, bare.leadScore);
  assert.equal(inquiry.leadGrade, bare.leadGrade);

  const dashboardProfile = scoreClientPropertyInquiry({
    inquiryText: 'Interested in this listing',
    clientProfile: {
      preferred_location: 'Lahore',
      purchase_timeline: '1_year',
      dream_home_price: 500000,
    },
    listingFields: {
      address: 'Lahore',
      location: 'Lahore',
      expected_price: '500000',
    },
    clientName: 'Muhamamd Ahmed',
    clientEmail: 'client@example.com',
    clientPhone: '',
  });
  assert.ok(
    dashboardProfile.leadScore > inquiry.leadScore,
    `expected timeline to increase score above ${inquiry.leadScore}, got ${dashboardProfile.leadScore}`,
  );

  const enriched = scoreClientPropertyInquiry({
    inquiryText: 'Ready to move soon',
    clientProfile: {
      purchase_timeline: 'asap',
      mortgage_status: 'paying_cash',
      realtor_status: 'no_agent',
      viewing_readiness: 'asap',
      offer_readiness: 'yes_immediately',
      motivation_reason: 'family_change',
      living_situation: 'renting',
    },
    listingFields: {
      address: 'lahore',
      location: 'lahore',
      expected_price: '500000',
    },
    clientName: 'Muhamamd Ahmed',
    clientEmail: 'client@example.com',
    clientPhone: '',
  });
  assert.ok(enriched.leadScore >= 60, `expected warm+, got ${enriched.leadScore}`);
  assert.ok(['warm', 'hot'].includes(enriched.leadGrade), `grade was ${enriched.leadGrade}`);
});

test('close reason validation enforces referral recipient rules', async () => {
  const { leadProfessionalType, validateCloseReasonForLead } = await import(
    '../services/lead/leadMatchFollowUpSync.js'
  );
  const closeErr = validateCloseReasonForLead({
    lead: { compatibility_factors: { professional_type: 'agent' } },
    nextStatus: 'converted',
    closeReason: '',
  });
  assert.ok(closeErr.includes('close_reason'));

  const closeOk = validateCloseReasonForLead({
    lead: { compatibility_factors: { professional_type: 'agent' } },
    nextStatus: 'converted',
    closeReason: 'deal_closed',
  });
  assert.equal(closeOk, null);
  assert.equal(leadProfessionalType({ compatibility_factors: { professional_type: 'lawyer' } }), 'lawyer');
  assert.equal(leadProfessionalType({}, 'mortgage_broker'), 'mortgage_broker');
});

test('leadMapperOptsFromRequest omits intent for non-agent roles', async () => {
  const { leadMapperOptsFromRequest } = await import('../services/lead/leadQueryUtils.js');
  assert.equal(leadMapperOptsFromRequest({ user: { role: 'agent' } }).includeIntentField, true);
  assert.equal(
    leadMapperOptsFromRequest({ user: { role: 'mortgage_broker' } }).includeIntentField,
    false,
  );
});
