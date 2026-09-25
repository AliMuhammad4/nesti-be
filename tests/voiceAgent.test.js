import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeTwilioSignature, verifyTwilioSignature } from '../services/proChat/twilioSignature.js';
import { normalizeSuggestions } from '../services/proChat/voiceAgentTurnService.js';
import { recordingIdempotencyKey } from '../services/proChat/recordingIngestionService.js';
import { buildRecordingObjectKey } from '../services/media/r2Client.js';
import { flagEnabled, voiceAgentAutocommitEnabled } from '../services/proChat/callProviders.js';
import { mapTwilioStatus, buildVoiceTwiml, shouldAdvanceCallStatus, terminalVoiceUpdate } from '../services/proChat/twilioVoiceService.js';
import { normalizeE164, pickSalesPhone } from '../services/proChat/voicePhone.js';
import { subscriptionPitchFacts } from '../services/proChat/voiceAgentTurnService.js';

test('twilio signature rejects tampering and accepts the canonical payload', () => {
  const params = { CallSid: 'CA1', RecordingSid: 'RE1' };
  const url = 'https://example.com/api/webhooks/twilio/recording';
  const signature = computeTwilioSignature('token', url, params);
  assert.equal(verifyTwilioSignature({ authToken: 'token', signature, url, params }), true);
  assert.equal(
    verifyTwilioSignature({ authToken: 'token', signature, url, params: { ...params, CallSid: 'CA2' } }),
    false,
  );
});

test('voice suggestions stay on the allowlist for the target type', () => {
  const items = normalizeSuggestions(
    [
      { action: 'lead.patch', payload: { match_status: 'nurturing' }, confidence: 0.8, rationale: 'follow up' },
      { action: 'delete.everything', payload: {}, confidence: 1 },
      { action: 'client.patch', payload: { home_goal: 'buy' }, confidence: 0.4 },
    ],
    { callId: 'call-1', targetType: 'lead', targetId: 'lead-1' },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].action, 'lead.patch');
  const clientItems = normalizeSuggestions(
    [{ action: 'lead.patch', payload: { lead_id: 'lead-9', match_status: 'nurturing' }, confidence: 0.7, rationale: 'booked' }],
    { callId: 'call-2', targetType: 'client', targetId: 'client-1', leadIds: ['lead-9'] },
  );
  assert.equal(clientItems[0].target_id, 'lead-9');
  assert.equal(clientItems[0].target_type, 'lead');
});

test('recording keys are private and deterministic', () => {
  const key = buildRecordingObjectKey({
    callId: 'call 1',
    recordingSid: 'RE123',
    now: new Date('2026-09-24T00:00:00Z'),
  });
  assert.equal(key, 'voice-recordings/2026/09/call_1/RE123.mp3');
  assert.equal(recordingIdempotencyKey('RE123'), 'twilio-recording:RE123');
  assert.doesNotMatch(key, /^https?:/);
});

test('feature flags default autocommit off', () => {
  const previous = process.env.VOICE_AGENT_AUTOCOMMIT;
  delete process.env.VOICE_AGENT_AUTOCOMMIT;
  assert.equal(voiceAgentAutocommitEnabled(), false);
  process.env.VOICE_AGENT_AUTOCOMMIT = 'true';
  assert.equal(flagEnabled('VOICE_AGENT_AUTOCOMMIT'), true);
  if (previous === undefined) delete process.env.VOICE_AGENT_AUTOCOMMIT;
  else process.env.VOICE_AGENT_AUTOCOMMIT = previous;
});

test('twilio status mapping and twiml stay inside the existing call lifecycle', () => {
  assert.equal(mapTwilioStatus('in-progress'), 'active');
  assert.equal(mapTwilioStatus('completed'), 'ended');
  const twiml = buildVoiceTwiml({ callId: 'abc', say: 'Hello & welcome' });
  assert.match(twiml, /Hello &amp; welcome/);
  assert.match(twiml, /Gather input="speech"/);
  assert.match(twiml, /voice="Polly\.Joanna"/);
  assert.match(twiml, /actionOnEmptyResult="true"/);
  assert.equal(shouldAdvanceCallStatus('active', 'ringing'), false);
  assert.equal(shouldAdvanceCallStatus('ringing', 'ended'), true);
  assert.equal(terminalVoiceUpdate({}).minutes_status, 'not_ready');
  assert.equal(terminalVoiceUpdate({ started_at: new Date() }).minutes_status, 'pending');
});

test('sales phones come from inquiry, professional profile, then user', () => {
  assert.equal(normalizeE164('(416) 555-0199'), '+14165550199');
  assert.equal(normalizeE164('not-a-phone'), '');
  assert.equal(pickSalesPhone({ inquiryPhone: '', profilePhone: '4165550100', userPhone: '+14165550101' }), '+14165550100');
  assert.match(subscriptionPitchFacts('client'), /\$9\.99/);
  assert.match(subscriptionPitchFacts('agent'), /\$150/);
});

test('admin and webhook entry points are wired', async () => {
  const [appSource, routes, server] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../routes/adminRoutes.js', import.meta.url), 'utf8'),
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
  ]);
  assert.match(appSource, /\/api\/webhooks\/twilio/);
  assert.match(appSource, /express\.urlencoded/);
  assert.match(routes, /router\.post\('\/voice\/calls', adminStartVoiceCall\)/);
  assert.match(routes, /\/voice\/recordings\/:id\/playback/);
  assert.match(routes, /\/voice\/suggestions\/:id\/decision/);
  assert.match(server, /startRecordingIngestion/);
});
