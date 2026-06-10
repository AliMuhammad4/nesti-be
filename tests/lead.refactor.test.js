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
