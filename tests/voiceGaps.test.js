import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createSalesPipeline } from '../services/proChat/salesPipeline.js';
import { ReplyRace } from '../workers/raviReplyRoute.js';
import { HearingSwitch } from '../workers/ravi/hearingSwitch.js';
import { AFTER_QUESTION_MS, missedCaller, quietDelayMs } from '../workers/ravi/quietCheckIn.js';
import { missedLine } from '../workers/ravi/lines.js';
import { answerTiming } from '../workers/ravi/turnLatency.js';
import { REPLY_WAIT_MS } from '../workers/ravi/replyWatchdog.js';

test('answer timing uses the wait the caller heard', () => {
  const turn = { end_of_turn_ms: 320, llm_first_token_ms: 610, tts_first_audio_ms: 290, heard_to_voice_ms: 1350 };
  assert.deepEqual(answerTiming(turn, 1220), { heard_ms: 320, model_first_ms: 610, voice_first_ms: 290, total_ms: 1350 });
  assert.equal(answerTiming({ end_of_turn_ms: 300 }, 300).total_ms, 300);
});

test('hearing with no spare never leaves OpenAI', () => {
  const primary = fakeRoute('gpt-4o-mini-transcribe');
  const hearing = new HearingSwitch({ primary });
  assert.equal(hearing.spareBroken, true);
  assert.equal(hearing.spare(), null);
  assert.equal(hearing.model, 'gpt-4o-mini-transcribe');
  hearing.noteLocalSpeech(true);
  assert.equal(hearing.stats.switchReason, '');
  assert.equal(REPLY_WAIT_MS, 1500);
});

test('a spoken sentence with no text asks to repeat once, real silence does not', () => {
  const c = { heard: { allFinals: 2, sinceRavi: { starts: 1, partials: 0, finals: 0 } } };
  assert.equal(missedCaller(c), true);
  c.missedAskedAtFinals = 2;
  assert.equal(missedCaller(c), false);
  c.heard.allFinals = 3;
  c.heard.sinceRavi = { starts: 1, partials: 2, finals: 1 };
  assert.equal(missedCaller(c), false);
  c.heard.sinceRavi = { starts: 0, partials: 0, finals: 0 };
  assert.equal(missedCaller(c), false);
  assert.match(missedLine('en'), /missed that/);
});

test('the check-in waits longer after Ravi asks a question', () => {
  assert.equal(quietDelayMs({ lastRaviText: 'Do you work on your own?' }, 8000), 8000 + AFTER_QUESTION_MS);
  assert.equal(quietDelayMs({ lastRaviText: 'Great, thanks.' }, 8000), 8000);
});

function fakeRoute(model) {
  const route = new EventEmitter();
  route.model = model;
  route.prewarm = () => {};
  route.aclose = async () => {};
  return route;
}

const ROLE_QUESTION = {
  client: /buy, sell, invest/i,
  agent: /independent realtor/i,
  broker: /independent broker/i,
  lawyer: /solo practitioner/i,
};

test('a slow LiveKit win starts the backup immediately next time', () => {
  const race = new ReplyRace({
    primary: fakeRoute('openai/gpt-4.1-mini'),
    backup: fakeRoute('gpt-4o-mini'),
  });
  race._primaryResult('won', '', 2000);
  assert.equal(race.hedgeMs, 0);
  race._primaryResult('won', '', 400);
  assert.equal(race.hedgeMs, 1800);
});

test('LiveKit sits out three replies after it loses a race, and stays out after a failure', () => {
  const events = [];
  const race = new ReplyRace({
    primary: fakeRoute('openai/gpt-4.1-mini'),
    backup: fakeRoute('gpt-4o-mini'),
    onEvent: (event) => events.push(event),
  });
  race._primaryResult('slow');
  assert.equal(events[0].type, 'primary_paused');
  assert.equal(events[0].turns, 3);
  assert.equal(race._primaryUsable(), false);
  assert.equal(race._primaryUsable(), false);
  assert.equal(race._primaryUsable(), false);
  assert.equal(events.some((event) => event.type === 'primary_back'), true);
  assert.equal(race._primaryUsable(), true);
  race._primaryResult('failed', 'HTTP 500');
  assert.equal(race._primaryUsable(), false);
  race._primaryResult('won');
  assert.equal(race._primaryUsable(), false);
});

test('each role is offered only its own first question', () => {
  for (const role of Object.keys(ROLE_QUESTION)) {
    const pipeline = createSalesPipeline(role, { roleKnown: true });
    const cue = pipeline.cue();
    assert.match(cue, ROLE_QUESTION[role]);
    for (const other of Object.keys(ROLE_QUESTION)) {
      if (other !== role) assert.doesNotMatch(cue, ROLE_QUESTION[other]);
    }
  }
});

test('a known role does not switch when the caller names another profession', () => {
  const pipeline = createSalesPipeline('broker', { roleKnown: true });
  pipeline.heard('I am a realtor in Toronto');
  assert.equal(pipeline.state.role, 'broker');
  assert.match(pipeline.cue(), ROLE_QUESTION.broker);
});

test('a call with no role yet learns it from the first hint', () => {
  const pipeline = createSalesPipeline('', { roleKnown: false });
  pipeline.heard('I am a mortgage broker');
  assert.equal(pipeline.state.role, 'broker');
  assert.match(pipeline.cue(), ROLE_QUESTION.broker);
});

test('a paraphrased question is stored and is not asked again', () => {
  const pipeline = createSalesPipeline('agent', { roleKnown: true });
  assert.match(pipeline.cue(), ROLE_QUESTION.agent);
  pipeline.said('Do you work on your own or with a team?');
  pipeline.heard('I work on my own');
  assert.equal(pipeline.state.answers.setup, 'I work on my own');
  assert.doesNotMatch(pipeline.cue(), ROLE_QUESTION.agent);
});

test('a saved question replaces the built-in wording for that role', () => {
  const pipeline = createSalesPipeline('client', {
    roleKnown: true,
    questions: { goal: 'What brings you to Nesti today?' },
  });
  assert.match(pipeline.cue(), /What brings you to Nesti today/);
  assert.doesNotMatch(pipeline.cue(), /buy, sell, invest/i);
});

test('an unrelated question is not saved as the offered one', () => {
  const pipeline = createSalesPipeline('agent', { roleKnown: true });
  assert.match(pipeline.cue(), ROLE_QUESTION.agent);
  pipeline.said('Which part of Toronto?');
  pipeline.heard('Mostly downtown');
  assert.equal(pipeline.state.answers.setup, undefined);
  assert.equal(pipeline.state.asked.includes('setup'), false);
});
