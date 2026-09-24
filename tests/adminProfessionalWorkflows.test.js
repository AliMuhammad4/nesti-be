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

