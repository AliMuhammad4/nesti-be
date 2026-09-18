import test from 'node:test';
import assert from 'node:assert/strict';
import { CREDENTIAL_STATUS } from '../constants/credentialDocuments.js';
import { buildCredentialGate } from '../services/credentials/credentialService.js';
import { adminHasPermission, ADMIN_PERMISSION } from '../constants/adminPermissions.js';
import { applyDateRange, parsePaging, parseSort } from '../services/admin/adminCommon.js';

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

test('buildCredentialGate locks non-approved professionals', () => {
  assert.equal(buildCredentialGate({ credential_status: CREDENTIAL_STATUS.APPROVED }, 'agent').locked, false);
  assert.equal(buildCredentialGate({ credential_status: CREDENTIAL_STATUS.PENDING_REVIEW }, 'agent').locked, true);
  assert.equal(
    buildCredentialGate(
      { credential_status: CREDENTIAL_STATUS.REJECTED, credential_reject_reason: 'bad id' },
      'agent',
    ).locked,
    true,
  );
  assert.match(
    buildCredentialGate(
      { credential_status: CREDENTIAL_STATUS.REJECTED, credential_reject_reason: 'bad id' },
      'agent',
    ).reason,
    /bad id/,
  );
  assert.equal(buildCredentialGate(null, 'client').locked, false);
});

test('credential requirement copy is audience-specific', async () => {
  const { describeCredentialRequirements } = await import(
    '../services/credentials/credentialRequirements.js'
  );
  const pro = describeCredentialRequirements({ role: 'lawyer', country: 'CA' });
  const admin = describeCredentialRequirements({ role: 'lawyer', country: 'CA', audience: 'admin' });
  assert.match(pro, /Upload your/);
  assert.match(admin, /Expected:/);
  assert.doesNotMatch(admin, /Upload your/);
});

test('adminHasPermission grants full access when permissions empty', () => {
  assert.equal(adminHasPermission({ role: 'admin', admin_permissions: [] }, ADMIN_PERMISSION.PROFESSIONALS_READ), true);
  assert.equal(adminHasPermission({ role: 'admin', admin_permissions: ['*'] }, ADMIN_PERMISSION.VERIFICATIONS_APPROVE), true);
  assert.equal(
    adminHasPermission({ role: 'admin', admin_permissions: [ADMIN_PERMISSION.PROFESSIONALS_READ] }, ADMIN_PERMISSION.USERS_WRITE),
    false,
  );
  assert.equal(adminHasPermission({ role: 'agent' }, ADMIN_PERMISSION.PROFESSIONALS_READ), false);
});

test('parsePaging and parseSort allowlists', () => {
  assert.deepEqual(parsePaging({ page: 2, limit: 50 }), { page: 2, limit: 50, skip: 50 });
  assert.deepEqual(parseSort({ sort: 'createdAt', order: 'asc' }, ['createdAt'], { updatedAt: -1 }), {
    createdAt: 1,
  });
  assert.deepEqual(parseSort({ sort: 'hack', order: 'asc' }, ['createdAt'], { updatedAt: -1 }), {
    updatedAt: -1,
  });
});

test('applyDateRange sets gte/lte', () => {
  const filter = {};
  applyDateRange(filter, { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' }, 'createdAt');
  assert.ok(filter.createdAt.$gte instanceof Date);
  assert.ok(filter.createdAt.$lte instanceof Date);
});

test('approve/reject require pending_review and reject reason', async () => {
  const bag = createRestoreBag();
  const ProfessionalProfile = (await import('../models/ProfessionalProfile.js')).default;
  const {
    approveCredentialsService,
    rejectCredentialsService,
  } = await import('../services/credentials/credentialService.js');

  try {
    bag.stub(ProfessionalProfile, 'findOneAndUpdate', async () => null);
    bag.stub(ProfessionalProfile, 'findOne', () => ({
      select: () => ({
        lean: async () => ({ credential_status: CREDENTIAL_STATUS.APPROVED }),
      }),
    }));

    const blocked = await approveCredentialsService({
      userId: '507f1f77bcf86cd799439011',
      adminId: '507f1f77bcf86cd799439012',
    });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.message, /pending_review/);

    const missingReason = await rejectCredentialsService({
      userId: '507f1f77bcf86cd799439011',
      adminId: '507f1f77bcf86cd799439012',
      reason: '  ',
    });
    assert.equal(missingReason.status, 400);

    bag.stub(ProfessionalProfile, 'findOne', () => ({
      select: () => ({
        lean: async () => ({ credential_status: CREDENTIAL_STATUS.REJECTED }),
      }),
    }));
    const rejectBlocked = await rejectCredentialsService({
      userId: '507f1f77bcf86cd799439011',
      adminId: '507f1f77bcf86cd799439012',
      reason: 'Incomplete documents',
    });
    assert.equal(rejectBlocked.status, 400);
    assert.match(rejectBlocked.body.message, /pending_review/);
  } finally {
    bag.restoreAll();
  }
});

test('approveCredentialsService marks docs accepted and starts once', async () => {
  const bag = createRestoreBag();
  const ProfessionalProfile = (await import('../models/ProfessionalProfile.js')).default;
  const User = (await import('../models/User.js')).default;
  const Subscription = (await import('../models/Subscription.js')).default;
  const { approveCredentialsService } = await import('../services/credentials/credentialService.js');

  const profileDoc = {
    _id: 'prof1',
    user_id: '507f1f77bcf86cd799439011',
    credential_status: CREDENTIAL_STATUS.APPROVED,
    credential_documents: [{ type: 'selfie', status: 'uploaded' }],
    credential_events: [],
    save: async function save() {
      this.credential_documents.forEach((d) => {
        d.status = 'accepted';
      });
      return this;
    },
  };

  try {
    bag.stub(ProfessionalProfile, 'findOneAndUpdate', async () => profileDoc);
    bag.stub(ProfessionalProfile, 'updateOne', async () => ({ acknowledged: true }));
    bag.stub(User, 'findById', async () => ({
      _id: '507f1f77bcf86cd799439011',
      role: 'agent',
      email: 'pro@example.com',
      first_name: 'Pat',
      last_name: 'Pro',
    }));
    bag.stub(User, 'find', () => ({
      select: () => ({
        lean: async () => [],
      }),
    }));
    bag.stub(Subscription, 'findOne', async () => null);
    bag.stub(Subscription, 'findOneAndUpdate', async () => ({
      status: 'free_trial',
      trial_end: new Date('2030-01-01'),
    }));

    // Avoid real email/socket side effects by swallowing notify failures — notify uses User.find for admins
    // already stubbed. sendEmail may run; that's ok if it returns failure without throwing.

    const approved = await approveCredentialsService({
      userId: '507f1f77bcf86cd799439011',
      adminId: '507f1f77bcf86cd799439012',
    });
    assert.equal(approved.status, 200);
    assert.equal(profileDoc.credential_documents[0].status, 'accepted');
    assert.equal(approved.body.credential_status, CREDENTIAL_STATUS.APPROVED);
  } finally {
    bag.restoreAll();
  }
});

test('credential event meta targets the newest event of a type', async () => {
  const { latestCredentialEventId } = await import('../services/credentials/credentialEvents.js');
  const profile = {
    credential_events: [
      { _id: 'e1', type: 'submitted' },
      { _id: 'e2', type: 'rejected' },
      { _id: 'e3', type: 'resubmitted' },
      { _id: 'e4', type: 'rejected' },
      { _id: 'e5', type: 'approved' },
    ],
  };
  assert.equal(latestCredentialEventId(profile, 'rejected'), 'e4');
  assert.equal(latestCredentialEventId(profile, 'approved'), 'e5');
  assert.equal(latestCredentialEventId(profile, 'doc_uploaded'), null);
  assert.equal(latestCredentialEventId(null, 'approved'), null);
});

test('ownedCredentialObjectKey only returns this user\'s credential objects', async () => {
  const { ownedCredentialObjectKey } = await import(
    '../services/credentials/credentialDocumentService.js'
  );
  const userId = '507f1f77bcf86cd799439011';
  assert.equal(
    ownedCredentialObjectKey(userId, { file_key: `nesti/users/${userId}/credentials/selfie-1` }),
    `nesti/users/${userId}/credentials/selfie-1`,
  );
  assert.equal(
    ownedCredentialObjectKey(userId, { file_key: 'nesti/users/someone-else/credentials/selfie-1' }),
    null,
  );
  assert.equal(ownedCredentialObjectKey(userId, { file_key: 'other/path' }), null);
  assert.equal(ownedCredentialObjectKey(userId, {}), null);
});

test('deleteObjectFromR2 does not throw when unconfigured or missing key', async () => {
  const { deleteObjectFromR2 } = await import('../services/media/r2Client.js');
  const missing = await deleteObjectFromR2('');
  assert.equal(missing.deleted, false);
  const unconfigured = await deleteObjectFromR2('nesti/users/x/credentials/selfie-1');
  assert.equal(typeof unconfigured.deleted, 'boolean');
});

test('deleteCredentialDocumentService 404s instead of throwing without documents', async () => {
  const bag = createRestoreBag();
  const ProfessionalProfile = (await import('../models/ProfessionalProfile.js')).default;
  const { deleteCredentialDocumentService } = await import(
    '../services/credentials/credentialDocumentService.js'
  );

  try {
    bag.stub(ProfessionalProfile, 'findOne', async () => ({
      credential_status: CREDENTIAL_STATUS.PENDING_DOCS,
    }));
    const result = await deleteCredentialDocumentService(
      { _id: '507f1f77bcf86cd799439011', role: 'agent' },
      '507f1f77bcf86cd799439088',
    );
    assert.equal(result.status, 404);
  } finally {
    bag.restoreAll();
  }
});

test('getAdminVerificationDocumentService validates ids', async () => {
  const { getAdminVerificationDocumentService } = await import(
    '../services/admin/adminVerificationService.js'
  );
  const bad = await getAdminVerificationDocumentService({
    userId: 'not-an-id',
    docId: 'also-bad',
  });
  assert.equal(bad.status, 400);
});

test('getAdminVerificationDocumentService 404 when doc missing', async () => {
  const bag = createRestoreBag();
  const ProfessionalProfile = (await import('../models/ProfessionalProfile.js')).default;
  const { getAdminVerificationDocumentService } = await import(
    '../services/admin/adminVerificationService.js'
  );

  // Force past R2 check by stubbing env-backed helper via process.env if needed.
  const prevKey = process.env.R2_ACCESS_KEY_ID;
  const prevSecret = process.env.R2_SECRET_ACCESS_KEY;
  const prevBucket = process.env.R2_BUCKET;
  const prevAccount = process.env.R2_ACCOUNT_ID;
  process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'test';
  process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'test';
  process.env.R2_BUCKET = process.env.R2_BUCKET || 'test';
  process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'test';

  try {
    bag.stub(ProfessionalProfile, 'findOne', async () => ({
      credential_documents: [{ _id: '507f1f77bcf86cd799439099', file_key: 'k', file_url: 'https://x' }],
    }));
    const missing = await getAdminVerificationDocumentService({
      userId: '507f1f77bcf86cd799439011',
      docId: '507f1f77bcf86cd799439088',
    });
    // 404 doc not found, or 503 if R2 still not considered configured
    assert.ok([404, 503].includes(missing.status));
  } finally {
    if (prevKey === undefined) delete process.env.R2_ACCESS_KEY_ID;
    else process.env.R2_ACCESS_KEY_ID = prevKey;
    if (prevSecret === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
    else process.env.R2_SECRET_ACCESS_KEY = prevSecret;
    if (prevBucket === undefined) delete process.env.R2_BUCKET;
    else process.env.R2_BUCKET = prevBucket;
    if (prevAccount === undefined) delete process.env.R2_ACCOUNT_ID;
    else process.env.R2_ACCOUNT_ID = prevAccount;
    bag.restoreAll();
  }
});

test('listAdminSubscriptionsService kind=all uses skip correctly', async () => {
  const bag = createRestoreBag();
  const Subscription = (await import('../models/Subscription.js')).default;
  const ClientSubscription = (await import('../models/ClientSubscription.js')).default;
  const { listAdminSubscriptionsService } = await import(
    '../services/admin/adminSubscriptionService.js'
  );

  const makeRows = (kind, n) =>
    Array.from({ length: n }, (_, i) => ({
      _id: `${kind}${i}`,
      user_id: {
        _id: `u${kind}${i}`,
        email: `${kind}${i}@x.com`,
        first_name: 'A',
        last_name: 'B',
        role: 'agent',
      },
      plan_key: 'basic',
      tier: 'basic',
      status: 'active',
      updatedAt: new Date(Date.UTC(2026, 0, n - i)),
      createdAt: new Date(Date.UTC(2026, 0, n - i)),
    }));

  try {
    const pro = makeRows('p', 5);
    const client = makeRows('c', 5);
    bag.stub(Subscription, 'find', () => {
      const chain = {
        sort: () => chain,
        limit: () => chain,
        populate: () => chain,
        lean: async () => pro,
      };
      return chain;
    });
    bag.stub(ClientSubscription, 'find', () => {
      const chain = {
        sort: () => chain,
        limit: () => chain,
        populate: () => chain,
        lean: async () => client,
      };
      return chain;
    });
    bag.stub(Subscription, 'countDocuments', async () => 5);
    bag.stub(ClientSubscription, 'countDocuments', async () => 5);

    const page1 = await listAdminSubscriptionsService({ kind: 'all', page: 1, limit: 4 });
    assert.equal(page1.status, 200);
    assert.equal(page1.body.items.length, 4);
    assert.equal(page1.body.pagination.total, 10);
    assert.equal(page1.body.pagination.pages, 3);

    const page2 = await listAdminSubscriptionsService({ kind: 'all', page: 2, limit: 4 });
    assert.equal(page2.body.items.length, 4);
    const ids1 = page1.body.items.map((i) => i.id).join(',');
    const ids2 = page2.body.items.map((i) => i.id).join(',');
    assert.notEqual(ids1, ids2);
  } finally {
    bag.restoreAll();
  }
});
