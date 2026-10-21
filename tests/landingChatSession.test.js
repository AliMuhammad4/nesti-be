import test from 'node:test';
import assert from 'node:assert/strict';
import EnterpriseInquiry from '../models/EnterpriseInquiry.js';
import LandingChatSession from '../models/LandingChatSession.js';
import LandingChatSetting from '../models/LandingChatSetting.js';
import {
  isSecureLandingSessionId,
  landingChatLeadDeps,
  loadLandingChatSession,
  saveAdminLead,
} from '../services/chat/nestiLanding/landingChatTurnService.js';
import {
  bindLandingChatSessionAudience,
  isLandingAudience,
  loadLandingChatSettingsRequired,
} from '../services/chat/nestiLanding/landingChatConfig.js';

function stub(object, key, replacement) {
  const original = object[key];
  object[key] = replacement;
  return () => { object[key] = original; };
}

test('landing chat restore rejects guessable session identifiers before any database lookup', async () => {
  let lookups = 0;
  const restore = stub(EnterpriseInquiry, 'findOne', () => { lookups += 1; });
  try {
    assert.equal(isSecureLandingSessionId('session_1234_abc'), false);
    const result = await loadLandingChatSession({
      embedToken: 'public-embed-token',
      sessionId: 'session_1234_abc',
    });
    assert.equal(result.status, 404);
    assert.equal(lookups, 0);
  } finally {
    restore();
  }
});

test('landing chat session capabilities require 256 bits of unpredictable hex', () => {
  assert.equal(isSecureLandingSessionId('a'.repeat(64)), true);
  assert.equal(isSecureLandingSessionId('a'.repeat(63)), false);
  assert.equal(isSecureLandingSessionId('g'.repeat(64)), false);
});

test('landing chat accepts only supported audience roles', () => {
  assert.equal(isLandingAudience('mortgage_broker'), true);
  assert.equal(isLandingAudience('client'), true);
  assert.equal(isLandingAudience('unknown'), false);
  assert.equal(isLandingAudience(''), false);
});

test('landing chat session audience is pinned independently from lead persistence', async () => {
  const session = { audience_role: 'agent' };
  let callCount = 0;
  const restore = stub(LandingChatSession, 'findOneAndUpdate', (filter, update, options) => {
    callCount += 1;
    assert.equal(filter.session_id, 'd'.repeat(64));
    assert.equal(update.$setOnInsert.audience_role, callCount === 1 ? 'agent' : 'client');
    assert.equal(options.upsert, true);
    return { lean: async () => session };
  });
  try {
    assert.deepEqual(
      await bindLandingChatSessionAudience('d'.repeat(64), 'agent'),
      { audience: 'agent', matches: true },
    );
    assert.deepEqual(
      await bindLandingChatSessionAudience('d'.repeat(64), 'client'),
      { audience: 'agent', matches: false },
    );
  } finally {
    restore();
  }
});

test('landing chat settings database failures surface as retryable service errors', async () => {
  const restore = stub(LandingChatSetting, 'findOne', () => {
    throw new Error('database connection failure');
  });
  try {
    await assert.rejects(loadLandingChatSettingsRequired(), (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /temporarily unavailable/i);
      assert.doesNotMatch(error.message, /database connection failure/i);
      return true;
    });
  } finally {
    restore();
  }
});

test('a returning lead adopts the current chat session capability', async () => {
  const oldSession = 'b'.repeat(64);
  const newSession = 'c'.repeat(64);
  const inquiry = {
    email: 'returning@example.com',
    phone: '4165550100',
    full_name: 'Returning Lead',
    source: 'landing_chat',
    session_id: oldSession,
    createdAt: new Date(),
    transcript: [{ role: 'user', text: 'Previous request' }],
    chat_state: {},
    chat_events: [],
    pipeline_stage: 'calling',
    status: 'contacted',
    async save() { return this; },
  };
  let findCalls = 0;
  const restores = [
    stub(EnterpriseInquiry, 'findOne', (filter) => {
      findCalls += 1;
      if (filter.session_id) return null;
      return { sort: async () => (filter.email ? inquiry : null) };
    }),
    stub(landingChatLeadDeps, 'notifyAdminsOfAdminLead', async () => {}),
    stub(landingChatLeadDeps, 'queueAdminLeadFollowUp', () => {}),
  ];
  try {
    const saved = await saveAdminLead({
      sessionId: newSession,
      contact: { email: inquiry.email, phone: inquiry.phone, name: inquiry.full_name },
      audience: 'client',
      spoken: 'I am ready to continue.',
      reply: 'Welcome back. Let us continue.',
      score: 4,
      grade: 'warm',
      chatState: { turns: 2 },
      chatEvents: [],
    });
    assert.equal(saved, inquiry);
    assert.equal(saved.session_id, newSession);
    assert.equal(saved.transcript.some((item) => item.text === 'I am ready to continue.'), true);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
