import test from 'node:test';
import assert from 'node:assert/strict';
import LeadMatch from '../models/LeadMatch.js';
import NurtureLog from '../models/NurtureLog.js';
import {
  assertWithinPlanQuota,
  getPlanVisibleLeadMatchIds,
  mergeLeadQueryWithPlanVisibility,
  planVisibleLeadMongoFilter,
  PlanQuotaError,
  resolvePlanLimit,
} from '../services/billing/planQuota.js';
import { SUBSCRIPTION_PLAN } from '../services/billing/entitlements.js';

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

test('resolvePlanLimit returns finite cap for basic and null for enterprise', () => {
  const basicSub = { plan_key: SUBSCRIPTION_PLAN.BASIC, status: 'active' };
  const enterpriseSub = { plan_key: SUBSCRIPTION_PLAN.ENTERPRISE, status: 'active' };
  const trialSub = { plan_key: SUBSCRIPTION_PLAN.BASIC, status: 'free_trial' };
  assert.equal(resolvePlanLimit(basicSub, 'captured_leads'), 50);
  assert.equal(resolvePlanLimit(enterpriseSub, 'captured_leads'), null);
  assert.equal(resolvePlanLimit(trialSub, 'captured_leads'), 10);
});

test('assertWithinPlanQuota passes under captured_leads limit', async () => {
  const bag = createRestoreBag();
  bag.stub(LeadMatch, 'countDocuments', async () => 0);
  try {
    const result = await assertWithinPlanQuota({
      userId: 'user1',
      subscription: { plan_key: SUBSCRIPTION_PLAN.BASIC, status: 'active' },
      limitKey: 'captured_leads',
    });
    assert.equal(result.used, 0);
    assert.equal(result.max, 50);
  } finally {
    bag.restoreAll();
  }
});

test('assertWithinPlanQuota throws at captured_leads cap', async () => {
  const bag = createRestoreBag();
  bag.stub(LeadMatch, 'countDocuments', async () => 50);
  try {
    await assert.rejects(
      () =>
        assertWithinPlanQuota({
          userId: 'user1',
          subscription: { plan_key: SUBSCRIPTION_PLAN.BASIC, status: 'active' },
          limitKey: 'captured_leads',
        }),
      (err) => {
        assert.ok(err instanceof PlanQuotaError);
        assert.equal(err.code, 'PLAN_LIMIT_REACHED');
        assert.equal(err.limitKey, 'captured_leads');
        assert.equal(err.used, 50);
        assert.equal(err.max, 50);
        return true;
      },
    );
  } finally {
    bag.restoreAll();
  }
});

test('assertWithinPlanQuota throws at followup_actions cap for standard', async () => {
  const bag = createRestoreBag();
  bag.stub(NurtureLog, 'countDocuments', async () => 500);
  try {
    await assert.rejects(
      () =>
        assertWithinPlanQuota({
          userId: 'user1',
          subscription: { plan_key: SUBSCRIPTION_PLAN.STANDARD, status: 'active' },
          limitKey: 'followup_actions',
        }),
      (err) => err instanceof PlanQuotaError,
    );
  } finally {
    bag.restoreAll();
  }
});

test('getPlanVisibleLeadMatchIds returns newest leads within cap', async () => {
  const bag = createRestoreBag();
  const ids = ['aaa', 'bbb', 'ccc'];
  bag.stub(LeadMatch, 'find', () => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => ids.map((_id) => ({ _id })),
  }));
  try {
    const visible = await getPlanVisibleLeadMatchIds('user1', {
      plan_key: SUBSCRIPTION_PLAN.BASIC,
      status: 'active',
    });
    assert.deepEqual(visible, ids);
  } finally {
    bag.restoreAll();
  }
});

test('plan visibility helpers merge mongo filters', () => {
  const base = { user_id: 'u1' };
  assert.deepEqual(mergeLeadQueryWithPlanVisibility(base, null), base);
  assert.deepEqual(planVisibleLeadMongoFilter(null), null);
  assert.deepEqual(planVisibleLeadMongoFilter(['a', 'b']), { _id: { $in: ['a', 'b'] } });
  assert.deepEqual(mergeLeadQueryWithPlanVisibility(base, { _id: { $in: ['a'] } }), {
    $and: [base, { _id: { $in: ['a'] } }],
  });
});

test('getPlanVisibleLeadMatchIds returns null for enterprise', async () => {
  const visible = await getPlanVisibleLeadMatchIds('user1', {
    plan_key: SUBSCRIPTION_PLAN.ENTERPRISE,
    status: 'active',
  });
  assert.equal(visible, null);
});

test('enterprise bypasses finite quota checks', async () => {
  const bag = createRestoreBag();
  bag.stub(NurtureLog, 'countDocuments', async () => 9999);
  try {
    const result = await assertWithinPlanQuota({
      userId: 'user1',
      subscription: { plan_key: SUBSCRIPTION_PLAN.ENTERPRISE, status: 'active' },
      limitKey: 'followup_actions',
    });
    assert.equal(result.max, null);
  } finally {
    bag.restoreAll();
  }
});
