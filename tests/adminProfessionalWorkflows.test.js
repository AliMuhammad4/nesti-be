import test from 'node:test';
import assert from 'node:assert/strict';
import { adminHasPermission, ADMIN_PERMISSION } from '../constants/adminPermissions.js';

function createRestoreBag() {
  const restores = [];
  return {
    stub(target, key, value) {
      const original = target[key];
      target[key] = value;
      restores.push(() => {
        target[key] = original;
      });
    },
    restoreAll() {
      while (restores.length) restores.pop()();
    },
  };
}

test('admin permissions fail-closed: empty/missing deny; only * grants all', () => {
  assert.equal(
    adminHasPermission({ role: 'admin', admin_permissions: [] }, ADMIN_PERMISSION.LEADS_READ),
    false,
  );
  assert.equal(adminHasPermission({ role: 'admin' }, ADMIN_PERMISSION.LEADS_WRITE), false);
  assert.equal(
    adminHasPermission({ role: 'admin', admin_permissions: ['*'] }, ADMIN_PERMISSION.REFERRALS_WRITE),
    true,
  );
  assert.equal(
    adminHasPermission(
      { role: 'admin', admin_permissions: [ADMIN_PERMISSION.LEADS_READ] },
      ADMIN_PERMISSION.LEADS_READ,
    ),
    true,
  );
  assert.equal(
    adminHasPermission(
      { role: 'admin', admin_permissions: [ADMIN_PERMISSION.LEADS_READ] },
      ADMIN_PERMISSION.LEADS_WRITE,
    ),
    false,
  );
});

test('listAdminLeadsService rejects invalid owner user_id instead of unscoped list', async () => {
  const { listAdminLeadsService } = await import('../services/admin/adminLeadService.js');
  const bad = await listAdminLeadsService({ user_id: 'not-a-valid-objectid' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /invalid owner user id/i);
});

test('listAdminReferralsService rejects invalid owner user_id instead of unscoped list', async () => {
  const { listAdminReferralsService } = await import('../services/admin/adminReferralService.js');
  const bad = await listAdminReferralsService({ user_id: 'zzzz' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /invalid owner user id/i);
});

test('patchAdminReferralService routes accept through processReferralForTarget', async () => {
  const bag = createRestoreBag();
  const Referral = (await import('../models/Referral.js')).default;
  const {
    patchAdminReferralService,
    adminReferralDeps,
  } = await import('../services/admin/adminReferralService.js');

  const referralId = '507f1f77bcf86cd799439011';
  const referrerId = '507f1f77bcf86cd799439012';
  const targetId = '507f1f77bcf86cd799439013';
  const actorId = '507f1f77bcf86cd799439099';

  let processCalls = 0;
  let patchCalls = 0;
  let auditCalls = [];

  const doc = {
    _id: referralId,
    user_id: referrerId,
    target_user_id: targetId,
    status: 'pending',
    notes: '',
  };

  try {
    bag.stub(Referral, 'findById', (id) => {
      if (String(id) !== referralId) return null;
      const chain = {
        populate() {
          return chain;
        },
        lean: async () => ({
          ...doc,
          user_id: {
            _id: referrerId,
            email: 'a@x.com',
            first_name: 'A',
            last_name: 'B',
            role: 'agent',
          },
          target_user_id: {
            _id: targetId,
            email: 'b@x.com',
            first_name: 'C',
            last_name: 'D',
            role: 'lawyer',
          },
        }),
      };
      return Object.assign(Promise.resolve(doc), chain);
    });

    bag.stub(adminReferralDeps, 'processReferralForTarget', async () => {
      processCalls += 1;
      return { ok: true, referral: { id: referralId, status: 'accepted' } };
    });
    const patchActors = [];
    bag.stub(adminReferralDeps, 'patchReferralForUser', async (uid, _id, patch) => {
      patchCalls += 1;
      patchActors.push(String(uid));
      return { ok: true, referral: { id: referralId, ...patch } };
    });
    bag.stub(adminReferralDeps, 'recordAdminAudit', async (payload) => {
      auditCalls.push(payload);
      return null;
    });

    const accepted = await patchAdminReferralService(
      referralId,
      { status: 'accepted', notes: 'admin note' },
      { _id: actorId },
    );
    assert.equal(accepted.status, 200);
    assert.equal(processCalls, 1);
    assert.equal(patchCalls, 1);
    assert.ok(auditCalls.some((a) => a.action === 'referral.patch' && a.outcome === 'ok'));

    processCalls = 0;
    patchCalls = 0;
    auditCalls = [];

    const rejected = await patchAdminReferralService(
      referralId,
      { status: 'rejected' },
      { _id: actorId },
    );
    assert.equal(rejected.status, 200);
    assert.equal(processCalls, 0);
    assert.equal(patchCalls, 1);
    assert.equal(patchActors.at(-1), String(targetId));
    assert.ok(auditCalls.some((a) => a.meta?.status === 'rejected'));
  } finally {
    bag.restoreAll();
  }
});

test('listAdminSalesPipelineService counts the full filtered lead set instead of the current page slice', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const User = (await import('../models/User.js')).default;
  const ProfessionalProfile = (await import('../models/ProfessionalProfile.js')).default;
  const Subscription = (await import('../models/Subscription.js')).default;
  const ClientSubscription = (await import('../models/ClientSubscription.js')).default;
  const {
    listAdminSalesPipelineService,
    buildAdminSalesPipelineAggregation,
  } = await import('../services/admin/adminSalesPipelineService.js');
  const pipeline = buildAdminSalesPipelineAggregation({}, { skip: 0, limit: 2, activeOnly: false });
  const countGroup = pipeline.find((step) => step.$facet?.counts).$facet.counts[0].$group;
  assert.deepEqual(
    countGroup.open.$sum.$cond[0],
    { $not: [{ $in: ['$close_outcome', ['won', 'lost']] }] },
  );
  assert.deepEqual(
    countGroup.ready_open.$sum.$cond[0].$and[1],
    { $not: [{ $in: ['$close_outcome', ['won', 'lost']] }] },
  );

  const allDocs = [
    { _id: '507f1f77bcf86cd799439031', source: 'landing_chat', full_name: 'A', email: 'a@example.com', interest_role: 'client', message: 'hello', createdAt: new Date('2024-01-01T00:00:00Z'), pipeline_stage: 'new', resolved_pipeline_stage: 'new' },
    { _id: '507f1f77bcf86cd799439032', source: 'landing_chat', full_name: 'B', email: 'b@example.com', interest_role: 'agent', message: 'hi', createdAt: new Date('2024-01-02T00:00:00Z'), pipeline_stage: 'new', resolved_pipeline_stage: 'new' },
    { _id: '507f1f77bcf86cd799439033', source: 'landing_chat', full_name: 'C', email: 'c@example.com', interest_role: 'broker', message: 'there', createdAt: new Date('2024-01-03T00:00:00Z'), pipeline_stage: 'ready', resolved_pipeline_stage: 'ready' },
    { _id: '507f1f77bcf86cd799439034', source: 'direct_inquiry', full_name: 'D', email: 'd@example.com', interest_role: 'lawyer', message: 'need help', createdAt: new Date('2024-01-04T00:00:00Z'), pipeline_stage: 'calling', resolved_pipeline_stage: 'calling' },
  ];
  const pageDocs = allDocs.slice(0, 2);

  try {
    bag.stub(EnterpriseInquiry, 'aggregate', async (pipeline) => {
      assert.ok(pipeline.some((step) => step.$facet?.filtered));
      assert.ok(pipeline.some((step) => step.$facet?.counts));
      assert.ok(pipeline.at(-1).$facet.items.some((step) => step.$limit === 2));
      return [{
        items: pageDocs,
        filtered: [{ total: 4 }],
        counts: [{ total: 4, new: 2, ready: 1, calling: 1 }],
      }];
    });
    bag.stub(User, 'find', () => ({ collation() { return this; }, select() { return { lean: async () => [] }; } }));
    bag.stub(ProfessionalProfile, 'find', () => ({ select() { return { lean: async () => [] }; } }));
    bag.stub(Subscription, 'find', () => ({ select() { return { lean: async () => [] }; } }));
    bag.stub(ClientSubscription, 'find', () => ({ select() { return { lean: async () => [] }; } }));

    const result = await listAdminSalesPipelineService({ page: 1, limit: 2 });
    assert.equal(result.status, 200);
    assert.equal(result.body.pagination.total, 4);
    assert.equal(result.body.counts.new, 2);
    assert.equal(result.body.counts.ready, 1);
    assert.equal(result.body.counts.calling, 1);
  } finally {
    bag.restoreAll();
  }
});

test('listAdminSalesPipelineService active board puts joined leads in ready and lost leads in closed', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const User = (await import('../models/User.js')).default;
  const ProfessionalProfile = (await import('../models/ProfessionalProfile.js')).default;
  const Subscription = (await import('../models/Subscription.js')).default;
  const ClientSubscription = (await import('../models/ClientSubscription.js')).default;
  const { listAdminSalesPipelineService } = await import('../services/admin/adminSalesPipelineService.js');

  const allDocs = [
    { _id: '507f1f77bcf86cd799439031', source: 'landing_chat', full_name: 'A', email: 'a@example.com', interest_role: 'client', message: 'hello', createdAt: new Date('2024-01-01T00:00:00Z'), pipeline_stage: 'new', resolved_pipeline_stage: 'new' },
    { _id: '507f1f77bcf86cd799439032', source: 'landing_chat', full_name: 'B', email: 'b@example.com', interest_role: 'agent', message: 'hi', createdAt: new Date('2024-01-02T00:00:00Z'), pipeline_stage: 'ready', close_outcome: 'won', close_note: 'Subscribed', resolved_pipeline_stage: 'ready' },
    { _id: '507f1f77bcf86cd799439033', source: 'direct_inquiry', full_name: 'C', email: 'c@example.com', interest_role: 'broker', message: 'there', createdAt: new Date('2024-01-03T00:00:00Z'), pipeline_stage: 'calling', close_outcome: 'lost', resolved_pipeline_stage: 'closed' },
  ];

  try {
    const filteredDocs = [allDocs, [allDocs[0]], [allDocs[2]], [allDocs[1]]];
    const aggregateCalls = [];
    bag.stub(EnterpriseInquiry, 'aggregate', async (pipeline) => {
      aggregateCalls.push(pipeline);
      const index = aggregateCalls.length - 1;
      const docs = filteredDocs[index] || [];
      return [{
        items: docs,
        filtered: [{ total: docs.length }],
        counts: [{
          total: 3, new: 1, ready: 1, calling: 0, closed: 1,
          open: 1, joined: 1, nurture: 1, chatbot: 2, direct: 1, ready_open: 0,
        }],
      }];
    });
    bag.stub(User, 'find', () => ({ collation() { return this; }, select() { return { lean: async () => [] }; } }));
    bag.stub(ProfessionalProfile, 'find', () => ({ select() { return { lean: async () => [] }; } }));
    bag.stub(Subscription, 'find', () => ({ select() { return { lean: async () => [] }; } }));
    bag.stub(ClientSubscription, 'find', () => ({ select() { return { lean: async () => [] }; } }));

    const result = await listAdminSalesPipelineService({ page: 1, limit: 10, active: '1' });
    assert.equal(result.status, 200);
    assert.equal(result.body.pagination.total, 3);
    assert.equal(result.body.items.length, 3);
    assert.equal(result.body.items.find((item) => item.name === 'A').stage, 'new');
    assert.equal(result.body.items.find((item) => item.name === 'B').stage, 'ready');
    assert.equal(result.body.items.find((item) => item.name === 'B').close_outcome, 'won');
    assert.equal(result.body.items.find((item) => item.name === 'B').close_note, 'Subscribed');
    assert.equal(result.body.items.find((item) => item.name === 'C').stage, 'closed');
    assert.equal(result.body.counts.new, 1);
    assert.equal(result.body.counts.ready, 1);
    assert.equal(result.body.counts.calling, 0);
    assert.equal(result.body.counts.closed, 1);
    assert.equal(result.body.counts.open, 1);
    assert.equal(result.body.counts.joined, 1);
    assert.equal(result.body.counts.nurture, 1);
    assert.equal(result.body.items.find((item) => item.name === 'B').status, 'joined');
    assert.equal(result.body.items.find((item) => item.name === 'C').status, 'nurture');
    assert.equal(result.body.pagination.has_next_page, false);

    const openOnly = await listAdminSalesPipelineService({ page: 1, limit: 10, status: 'open' });
    assert.deepEqual(openOnly.body.items.map((item) => item.name), ['A']);
    assert.equal(openOnly.body.pagination.total, 1);

    const nurtureBrokers = await listAdminSalesPipelineService({ page: 1, limit: 10, status: 'nurture', role: 'broker', source: 'direct-query' });
    assert.deepEqual(nurtureBrokers.body.items.map((item) => item.name), ['C']);

    const searched = await listAdminSalesPipelineService({ page: 1, limit: 10, q: 'b@example' });
    assert.deepEqual(searched.body.items.map((item) => item.name), ['B']);
    assert.ok(aggregateCalls[1].some((step) => step.$facet?.items?.[0]?.$match?.$and?.some((clause) => clause.close_outcome)));
    assert.ok(aggregateCalls[2].some((step) => step.$facet?.items?.[0]?.$match?.$and?.some((clause) => clause.$expr)));
    assert.ok(aggregateCalls[3].some((step) => step.$facet?.items?.[0]?.$match?.$and?.some((clause) => clause.$or)));
  } finally {
    bag.restoreAll();
  }
});

test('a returning direct query reopens the nurture lead instead of creating a duplicate', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const User = (await import('../models/User.js')).default;
  const { createDirectAdminInquiry } = await import('../services/admin/directInquiryService.js');

  let saved = 0;
  let created = 0;
  const nurture = {
    _id: '507f1f77bcf86cd799439041',
    source: 'direct_inquiry',
    email: 'back@example.com',
    full_name: 'Back Again',
    close_outcome: 'lost',
    close_note: 'Not now',
    closed_at: new Date('2024-01-01T00:00:00Z'),
    status: 'resolved',
    pipeline_stage: 'new',
    reopen_count: 0,
    async save() { saved += 1; return this; },
  };

  try {
    bag.stub(EnterpriseInquiry, 'findOne', (query) => ({
      sort: async () => (query.close_outcome === 'lost' ? nurture : null),
    }));
    bag.stub(EnterpriseInquiry, 'findById', async () => null);
    bag.stub(EnterpriseInquiry, 'create', async () => { created += 1; return {}; });
    bag.stub(User, 'find', () => ({ select() { return { lean: async () => [] }; } }));

    const result = await createDirectAdminInquiry({
      email: 'back@example.com',
      full_name: 'Back Again',
      message: 'Ready to look at plans now',
    });
    assert.equal(result, nurture);
    assert.equal(created, 0);
    assert.equal(saved, 1);
    assert.equal(nurture.close_outcome, '');
    assert.equal(nurture.pipeline_stage, 'calling');
    assert.equal(nurture.reopen_count, 1);
    assert.equal(nurture.message, 'Ready to look at plans now');
  } finally {
    bag.restoreAll();
  }
});

test('a successful direct inquiry thank-you is recorded in that lead email history', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const { directInquiryDeps, createDirectAdminInquiry } = await import('../services/admin/directInquiryService.js');
  const inquiry = {
    _id: '507f1f77bcf86cd799439043',
    email: 'new@example.com',
    source: 'direct_inquiry',
    guide_emails: [],
    async save() { return this; },
  };

  try {
    bag.stub(EnterpriseInquiry, 'findOne', () => ({ sort: async () => null }));
    bag.stub(EnterpriseInquiry, 'create', async () => inquiry);
    bag.stub(directInquiryDeps, 'notifyAdminsOfAdminLead', async () => {});
    bag.stub(directInquiryDeps, 'queueAdminLeadFollowUp', () => {});
    bag.stub(directInquiryDeps, 'sendLandingThanksEmail', async () => ({
      sent: true,
      to: 'new@example.com',
      subject: 'Welcome to Nesti',
      message: 'Thanks for reaching out.',
    }));

    await createDirectAdminInquiry({
      email: 'new@example.com',
      full_name: 'New Lead',
      message: 'I want to learn about plans.',
    });

    assert.equal(inquiry.guide_emails.length, 1);
    assert.deepEqual(inquiry.guide_emails[0], {
      to_email: 'new@example.com',
      subject: 'Welcome to Nesti',
      body: 'Thanks for reaching out.',
      type: 'automatic',
      status: 'sent',
      idempotency_key: `direct_inquiry_thanks:${inquiry._id}`,
      sent_at: inquiry.guide_emails[0].sent_at,
    });
    assert.ok(inquiry.guide_emails[0].sent_at instanceof Date);
  } finally {
    bag.restoreAll();
  }
});

test('a successful chatbot welcome is linked to the matching admin lead once', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const { recordLandingWelcomeOnAdminLead } = await import('../services/chat/nestiLanding/notifyAdminsOfLandingLead.js');
  const updates = [];
  const inquiryId = '507f1f77bcf86cd799439044';
  const leadMatchId = '507f1f77bcf86cd799439045';

  try {
    bag.stub(EnterpriseInquiry, 'findOne', () => ({
      sort() { return this; },
      select() { return this; },
      lean: async () => ({ _id: inquiryId }),
    }));
    bag.stub(EnterpriseInquiry, 'updateOne', async (filter, update) => { updates.push({ filter, update }); });

    const recorded = await recordLandingWelcomeOnAdminLead({
      leadMatchId,
      email: 'chat@example.com',
      sent: { sent: true, to: 'chat@example.com', subject: 'Welcome', message: 'Thanks for chatting.' },
    });
    const failed = await recordLandingWelcomeOnAdminLead({
      leadMatchId: '507f1f77bcf86cd799439046',
      email: 'chat@example.com',
      sent: { sent: false, to: 'chat@example.com', subject: 'Welcome', message: 'Not sent.' },
    });

    assert.equal(recorded, true);
    assert.equal(failed, false);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].filter._id, inquiryId);
    assert.equal(updates[0].filter['guide_emails.idempotency_key'].$ne, `landing_welcome:${leadMatchId}`);
    assert.equal(updates[0].update.$push.guide_emails.body, 'Thanks for chatting.');
    assert.equal(updates[0].update.$push.guide_emails.type, 'automatic');
  } finally {
    bag.restoreAll();
  }
});

test('isCalendlyAlreadyCanceledMessage treats already-canceled as idempotent', async () => {
  const { isCalendlyAlreadyCanceledMessage } = await import(
    '../services/calendly/cancelCalendlyBooking.js'
  );
  assert.equal(isCalendlyAlreadyCanceledMessage(400, 'Event has already been canceled'), true);
  assert.equal(isCalendlyAlreadyCanceledMessage(404, 'already cancelled'), true);
  assert.equal(isCalendlyAlreadyCanceledMessage(502, 'upstream timeout'), false);
});

test('adminCreateLeadReferralService never persists accepted without processReferralForTarget', async () => {
  const bag = createRestoreBag();
  const LeadMatch = (await import('../models/LeadMatch.js')).default;
  const User = (await import('../models/User.js')).default;
  const {
    adminCreateLeadReferralService,
    adminLeadOwnerActionDeps,
  } = await import('../services/admin/adminLeadOwnerActionsService.js');

  const leadId = '507f1f77bcf86cd799439021';
  const ownerId = '507f1f77bcf86cd799439022';
  const targetId = '507f1f77bcf86cd799439023';
  const referralId = '507f1f77bcf86cd799439024';
  const createBodies = [];
  let processCalls = 0;

  try {
    bag.stub(LeadMatch, 'findById', (id) => ({
      lean: async () => (String(id) === leadId ? { _id: leadId, user_id: ownerId } : null),
    }));
    bag.stub(User, 'findById', () => ({
      select() {
        return {
          lean: async () => ({ _id: ownerId, role: 'agent' }),
        };
      },
    }));
    bag.stub(adminLeadOwnerActionDeps, 'createReferralForUser', async (_ownerId, body) => {
      createBodies.push(body);
      return {
        ok: true,
        referral: { id: referralId, status: body.status || 'pending', target_user_id: targetId },
      };
    });
    bag.stub(adminLeadOwnerActionDeps, 'processReferralForTarget', async () => {
      processCalls += 1;
      return { ok: true, referral: { id: referralId, status: 'accepted' } };
    });
    bag.stub(adminLeadOwnerActionDeps, 'recordAdminAudit', async () => null);
    bag.stub(adminLeadOwnerActionDeps, 'Referral', {
      findById: async (id) =>
        String(id) === referralId
          ? { _id: referralId, target_user_id: targetId, user_id: ownerId, status: 'pending' }
          : null,
    });

    const result = await adminCreateLeadReferralService(
      leadId,
      { target_user_id: targetId, status: 'accepted', notes: 'n' },
      { _id: '507f1f77bcf86cd799439099' },
    );
    assert.equal(result.status, 200);
    assert.equal(createBodies.length, 1);
    assert.equal(createBodies[0].status, undefined);
    assert.equal(processCalls, 1);
  } finally {
    bag.restoreAll();
  }
});

test('deleteAdminLeadService skips plan visibility for admin deletes', async () => {
  const bag = createRestoreBag();
  const {
    deleteAdminLeadService,
    adminLeadServiceDeps,
  } = await import('../services/admin/adminLeadService.js');

  const leadId = '507f1f77bcf86cd799439031';
  const ownerId = '507f1f77bcf86cd799439032';
  let deleteOpts = null;

  try {
    bag.stub(adminLeadServiceDeps, 'LeadMatch', {
      findById: () => ({
        select() {
          return {
            lean: async () => ({ _id: leadId, user_id: ownerId }),
          };
        },
      }),
    });
    bag.stub(adminLeadServiceDeps, 'deleteOwnedLeadMatch', async (_userId, _id, opts = {}) => {
      deleteOpts = opts;
    });
    bag.stub(adminLeadServiceDeps, 'recordAdminAudit', async () => null);

    const result = await deleteAdminLeadService(leadId, { _id: '507f1f77bcf86cd799439099' });
    assert.equal(result.status, 200);
    assert.equal(deleteOpts?.skipPlanCheck, true);
  } finally {
    bag.restoreAll();
  }
});

test('reassignLeadOwner moves future booked appointments and profile ownership', async () => {
  const bag = createRestoreBag();
  const {
    reassignLeadOwner,
    adminLeadServiceDeps,
  } = await import('../services/admin/adminLeadService.js');

  const leadId = '507f1f77bcf86cd799439041';
  const prevOwnerId = '507f1f77bcf86cd799439042';
  const nextOwnerId = '507f1f77bcf86cd799439043';
  const profileId = '507f1f77bcf86cd799439044';
  const appointmentFilters = [];
  const profileFilters = [];
  let savedOwner = null;

  const lead = {
    _id: leadId,
    user_id: prevOwnerId,
    lead_profile_id: profileId,
    professional_profile_id: null,
    compatibility_factors: {},
    set() {},
    async save() {
      savedOwner = String(this.user_id);
    },
  };

  try {
    bag.stub(adminLeadServiceDeps, 'WorkspaceAppointment', {
      updateMany: async (filter, update) => {
        appointmentFilters.push({ filter, update });
        return { modifiedCount: 1 };
      },
    });
    bag.stub(adminLeadServiceDeps, 'LeadProfile', {
      updateOne: async (filter, update) => {
        profileFilters.push({ filter, update });
        return { modifiedCount: 1 };
      },
    });
    bag.stub(adminLeadServiceDeps, 'ProfessionalChatThread', {
      findById: () => ({
        session() {
          return this;
        },
        then(resolve) {
          resolve(null);
        },
      }),
    });

    const meta = await reassignLeadOwner({
      lead,
      nextOwnerId,
      nextProfileId: null,
      session: null,
    });

    assert.equal(meta.prevOwnerId, prevOwnerId);
    assert.equal(meta.nextOwnerId, nextOwnerId);
    assert.equal(savedOwner, nextOwnerId);
    assert.equal(appointmentFilters.length, 1);
    assert.equal(String(appointmentFilters[0].filter.user_id), prevOwnerId);
    assert.equal(appointmentFilters[0].filter.status, 'booked');
    assert.equal(String(appointmentFilters[0].update.$set.user_id), nextOwnerId);
    assert.equal(String(profileFilters[0].filter._id), profileId);
    assert.equal(String(profileFilters[0].update.$set['ownership.user_id']), nextOwnerId);
  } finally {
    bag.restoreAll();
  }
});

test('patchAdminLeadService fails closed when transactions are unavailable', async () => {
  const bag = createRestoreBag();
  const LeadMatch = (await import('../models/LeadMatch.js')).default;
  const User = (await import('../models/User.js')).default;
  const ProfessionalProfile = (await import('../models/ProfessionalProfile.js')).default;
  const AdminAuditLog = (await import('../models/AdminAuditLog.js')).default;
  const {
    patchAdminLeadService,
    adminLeadServiceDeps,
  } = await import('../services/admin/adminLeadService.js');

  const leadId = '507f1f77bcf86cd799439051';
  const ownerId = '507f1f77bcf86cd799439052';
  const nextOwnerId = '507f1f77bcf86cd799439053';
  let txnCalls = 0;

  try {
    bag.stub(AdminAuditLog, 'create', async () => null);
    bag.stub(LeadMatch, 'findById', async (id) => {
      if (String(id) !== leadId) return null;
      return {
        _id: leadId,
        user_id: ownerId,
        match_status: 'new',
        lead_type: 'buyer',
      };
    });
    bag.stub(User, 'findById', (id) => {
      const role = String(id) === nextOwnerId ? 'agent' : 'agent';
      return {
        select() {
          return {
            lean: async () => ({ _id: id, role, email: 'p@x.com', first_name: 'P', last_name: 'Q' }),
          };
        },
      };
    });
    bag.stub(ProfessionalProfile, 'findOne', () => ({
      select() {
        return {
          lean: async () => ({ _id: '507f1f77bcf86cd799439054', professional_type: 'agent' }),
        };
      },
    }));
    bag.stub(adminLeadServiceDeps, 'withRequiredTransaction', async () => {
      txnCalls += 1;
      const err = new Error('Lead reassignment requires a replica-set MongoDB transaction');
      err.statusCode = 503;
      err.code = 'TRANSACTIONS_UNAVAILABLE';
      throw err;
    });

    const result = await patchAdminLeadService(
      leadId,
      { user_id: nextOwnerId, match_status: 'contacted', lead_type: 'seller' },
      { user: { _id: '507f1f77bcf86cd799439099' } },
    );
    assert.equal(txnCalls, 1);
    assert.equal(result.status, 503);
    assert.match(String(result.body?.message || ''), /transaction|unavailable/i);
  } finally {
    bag.restoreAll();
  }
});

test('deleteAdminSalesLeadService removes a desk inquiry and rejects other sources', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const { deleteAdminSalesLeadService } = await import('../services/admin/adminSalesPipelineService.js');
  const id = '507f1f77bcf86cd799439041';
  let deleted = '';

  try {
    bag.stub(EnterpriseInquiry, 'findById', (asked) => ({
      select() {
        return {
          lean: async () => (String(asked) === id
            ? { _id: id, source: 'landing_chat' }
            : { _id: asked, source: 'demo' }),
        };
      },
    }));
    bag.stub(EnterpriseInquiry, 'findByIdAndDelete', async (asked) => {
      deleted = String(asked);
      return { _id: asked };
    });

    const removed = await deleteAdminSalesLeadService(id);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.deleted, true);
    assert.equal(deleted, id);

    const rejected = await deleteAdminSalesLeadService('507f1f77bcf86cd799439042');
    assert.equal(rejected.status, 404);
    const invalid = await deleteAdminSalesLeadService('not-an-id');
    assert.equal(invalid.status, 400);
  } finally {
    bag.restoreAll();
  }
});

test('admin sales close and send schemas reject bad payloads', async () => {
  const { adminSalesLeadCloseSchema, adminSalesLeadEmailSendSchema } = await import('../schemas/opsSchemas.js');
  assert.ok(adminSalesLeadCloseSchema.validate({ outcome: 'maybe' }).error);
  assert.equal(adminSalesLeadCloseSchema.validate({ outcome: 'won', note: 'subscribed' }).error, undefined);
  assert.ok(adminSalesLeadEmailSendSchema.validate({ subject: '', body: 'hello' }).error);
  assert.equal(adminSalesLeadEmailSendSchema.validate({ subject: 'Hello', body: 'Just this letter.' }).error, undefined);
});

test('admin sales lead can only be marked joined with a linked subscription', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const User = (await import('../models/User.js')).default;
  const Subscription = (await import('../models/Subscription.js')).default;
  const ClientSubscription = (await import('../models/ClientSubscription.js')).default;
  const { closeAdminLeadService } = await import('../services/admin/adminLeadGuideEmailService.js');
  const id = '507f1f77bcf86cd799439052';
  const userId = '507f1f77bcf86cd799439053';
  let saved = 0;
  const row = {
    _id: id,
    source: 'direct_inquiry',
    email: 'joined@example.com',
    user_id: userId,
    async save() { saved += 1; return this; },
  };

  try {
    bag.stub(EnterpriseInquiry, 'findById', async () => row);
    bag.stub(User, 'findById', () => ({ select() { return { lean: async () => ({ _id: userId }) }; } }));
    bag.stub(Subscription, 'exists', async () => null);
    bag.stub(ClientSubscription, 'exists', async () => null);

    const rejected = await closeAdminLeadService(id, { outcome: 'won', note: 'Looks ready' });
    assert.equal(rejected.status, 409);
    assert.equal(saved, 0);
    assert.equal(row.close_outcome, undefined);

    bag.stub(ClientSubscription, 'exists', async () => ({ _id: 'subscription-id' }));
    const joined = await closeAdminLeadService(id, { outcome: 'won', note: 'Subscribed' });
    assert.equal(joined.status, 200);
    assert.equal(row.close_outcome, 'won');
    assert.equal(saved, 1);
  } finally {
    bag.restoreAll();
  }
});

test('sales voice outcome is saved on both the inquiry and its call record', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const ProfessionalCall = (await import('../models/ProfessionalCall.js')).default;
  const { persistSalesOutcome } = await import('../services/proChat/voiceAgentTurnService.js');
  const callId = '507f1f77bcf86cd799439061';
  const leadId = '507f1f77bcf86cd799439062';
  const callUpdates = [];
  const leadUpdates = [];

  try {
    bag.stub(ProfessionalCall, 'findById', () => ({
      select() { return { lean: async () => ({ _id: callId, voice_target_type: 'sales', voice_target_id: leadId }) }; },
    }));
    bag.stub(EnterpriseInquiry, 'findById', () => ({
      select() { return { lean: async () => ({ pipeline_stage: 'new', close_outcome: '' }) }; },
    }));
    bag.stub(EnterpriseInquiry, 'updateOne', async (filter, update) => { leadUpdates.push({ filter, update }); });
    bag.stub(ProfessionalCall, 'updateOne', async (filter, update) => { callUpdates.push({ filter, update }); });

    const result = await persistSalesOutcome({ callId, outcome: 'callback', plan: '', note: 'Call tomorrow morning.' });

    assert.equal(result.ok, true);
    assert.equal(leadUpdates[0].filter._id, leadId);
    assert.equal(leadUpdates[0].update.$set.voice_outcome, 'callback');
    assert.equal(callUpdates[0].filter._id, callId);
    assert.equal(callUpdates[0].update.$set.voice_outcome, 'callback');
    assert.equal(callUpdates[0].update.$set.voice_outcome_note, 'Call tomorrow morning.');
  } finally {
    bag.restoreAll();
  }
});

test('sendAdminLeadEmailService records sent and failed attempts', async () => {
  const bag = createRestoreBag();
  const EnterpriseInquiry = (await import('../models/EnterpriseInquiry.js')).default;
  const { salesEmailDeps, sendAdminLeadEmailService } = await import('../services/admin/adminLeadGuideEmailService.js');
  const id = '507f1f77bcf86cd799439051';
    const posted = 'Hello Dana.\n- Chatbot: You can place it on your own site.';
  let saved = null;

  const row = {
    _id: id,
    source: 'landing_chat',
    email: 'dana@example.com',
    interest_role: 'agent',
    email_draft: { origin: 'manual', subject: '', body: '' },
    guide_emails: [],
    async save() { saved = this; return this; },
  };

  try {
    bag.stub(EnterpriseInquiry, 'findById', async () => row);
    bag.stub(salesEmailDeps, 'sendEmail', async () => ({ success: true }));
    const sent = await sendAdminLeadEmailService(id, { subject: 'Your Nesti note', body: posted });
    assert.equal(sent.status, 200);
    assert.equal(saved.guide_emails.length, 1);
    assert.equal(saved.guide_emails[0].body, posted);
    assert.equal(saved.guide_emails[0].body.includes('Storefront'), false);
    assert.equal(saved.guide_emails[0].to_email, 'dana@example.com');
    assert.equal(saved.guide_emails[0].type, 'manual');
    assert.equal(saved.guide_emails[0].status, 'sent');

    bag.stub(salesEmailDeps, 'sendEmail', async () => ({ success: false }));
    const failed = await sendAdminLeadEmailService(id, { subject: 'Your Nesti note', body: posted });
    assert.equal(failed.status, 502);
    assert.equal(row.guide_emails.length, 2);
    assert.equal(row.guide_emails[1].status, 'failed');
  } finally {
    bag.restoreAll();
  }
});
