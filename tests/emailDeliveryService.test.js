import test from 'node:test';
import assert from 'node:assert/strict';
import { emailDeliveryDeps, sendIdempotentEmail } from '../services/email/emailDeliveryService.js';

function stub(object, key, replacement) {
  const original = object[key];
  object[key] = replacement;
  return () => { object[key] = original; };
}

function duplicateKeyError() {
  const error = new Error('duplicate key');
  error.code = 11000;
  return error;
}

function createMemoryDeliveryModel() {
  const records = new Map();
  let nextId = 1;
  return {
    records,
    async init() {},
    async create(input) {
      if (records.has(input.idempotency_key)) throw duplicateKeyError();
      const now = new Date();
      const record = { _id: String(nextId++), createdAt: now, updatedAt: now, ...input };
      records.set(input.idempotency_key, record);
      return record;
    },
    async findOne(filter) {
      return records.get(filter.idempotency_key) || null;
    },
    async findOneAndUpdate(filter, update) {
      const record = [...records.values()].find((item) => (
        item._id === String(filter._id)
        && item.status === filter.status
        && (!filter.updatedAt || item.updatedAt?.getTime() === new Date(filter.updatedAt).getTime())
      ));
      if (!record) return null;
      Object.assign(record, update.$set);
      if (update.$inc?.attempt_count) record.attempt_count += update.$inc.attempt_count;
      record.updatedAt = new Date();
      return record;
    },
    async updateOne(filter, update) {
      const record = [...records.values()].find((item) => (
        item._id === String(filter._id) && item.status === filter.status
      ));
      if (record) {
        Object.assign(record, update.$set);
        record.updatedAt = new Date();
      }
      return { modifiedCount: record ? 1 : 0 };
    },
  };
}

test('tracked email is reserved atomically and duplicate requests do not resend', async () => {
  const model = createMemoryDeliveryModel();
  let sends = 0;
  const restores = [
    stub(emailDeliveryDeps, 'EmailDelivery', model),
    stub(emailDeliveryDeps, 'sendEmail', async () => {
      sends += 1;
      return { success: true, id: 'provider-1' };
    }),
  ];
  try {
    const options = {
      email: 'lead@example.com',
      subject: 'Checking in',
      message: 'Would you like to continue?',
      idempotencyKey: 'followup:lead:2026-10-13',
      source: 'fifteen_day_followup',
    };
    const first = await sendIdempotentEmail(options);
    const duplicate = await sendIdempotentEmail(options);
    assert.equal(first.success, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(sends, 1);
    assert.equal(model.records.get(options.idempotencyKey).status, 'sent');
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test('concurrent delivery attempts share one in-progress reservation', async () => {
  const model = createMemoryDeliveryModel();
  let releaseSend;
  let sends = 0;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const restores = [
    stub(emailDeliveryDeps, 'EmailDelivery', model),
    stub(emailDeliveryDeps, 'sendEmail', async () => {
      sends += 1;
      await sendGate;
      return { success: true, id: 'provider-2' };
    }),
  ];
  try {
    const options = {
      email: 'lead@example.com',
      subject: 'Checking in',
      message: 'Would you like to continue?',
      idempotencyKey: 'followup:lead:parallel',
    };
    const firstPromise = sendIdempotentEmail(options);
    await new Promise((resolve) => setImmediate(resolve));
    const concurrent = await sendIdempotentEmail(options);
    assert.equal(concurrent.inProgress, true);
    assert.equal(sends, 1);
    releaseSend();
    assert.equal((await firstPromise).success, true);
  } finally {
    releaseSend();
    restores.reverse().forEach((restore) => restore());
  }
});

test('ambiguous provider results are held for review instead of being retried', async () => {
  const model = createMemoryDeliveryModel();
  let sends = 0;
  const restores = [
    stub(emailDeliveryDeps, 'EmailDelivery', model),
    stub(emailDeliveryDeps, 'sendEmail', async () => {
      sends += 1;
      return { success: false, uncertain: true, error: new Error('request timed out') };
    }),
  ];
  try {
    const options = {
      email: 'lead@example.com',
      subject: 'Checking in',
      message: 'Would you like to continue?',
      idempotencyKey: 'followup:lead:ambiguous',
    };
    const first = await sendIdempotentEmail(options);
    const retry = await sendIdempotentEmail(options);
    assert.equal(first.uncertain, true);
    assert.equal(retry.uncertain, true);
    assert.equal(sends, 1);
    assert.equal(model.records.get(options.idempotencyKey).status, 'uncertain');
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test('expired delivery reservations transition to uncertain without an automatic resend', async () => {
  const model = createMemoryDeliveryModel();
  const options = {
    email: 'lead@example.com',
    subject: 'Checking in',
    message: 'Would you like to continue?',
    idempotencyKey: 'followup:lead:stale',
  };
  const record = await model.create({
    idempotency_key: options.idempotencyKey,
    recipient: options.email,
    subject: options.subject,
    text_body: options.message,
    status: 'sending',
    attempt_count: 1,
  });
  record.updatedAt = new Date(Date.now() - 11 * 60 * 1000);
  let sends = 0;
  const restores = [
    stub(emailDeliveryDeps, 'EmailDelivery', model),
    stub(emailDeliveryDeps, 'sendEmail', async () => {
      sends += 1;
      return { success: true, id: 'unexpected-send' };
    }),
  ];
  try {
    const result = await sendIdempotentEmail(options);
    assert.equal(result.uncertain, true);
    assert.equal(sends, 0);
    assert.equal(record.status, 'uncertain');
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
