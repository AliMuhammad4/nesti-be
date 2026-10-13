import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAdminPipelineStage,
  fieldsForVoiceOutcome,
  hasLiveConversation,
  leadStatus,
  nextAutoPipelineStage,
  recommendedAdminLeadAction,
  reopenNurtureLead,
  resolveAdminPipelineStage,
} from '../services/admin/adminPipelineStage.js';

test('lead status separates open, joined, and nurture leads', () => {
  assert.equal(leadStatus({ pipeline_stage: 'ready' }), 'open');
  assert.equal(leadStatus({ pipeline_stage: 'ready', close_outcome: 'won' }), 'joined');
  assert.equal(leadStatus({ pipeline_stage: 'calling', close_outcome: 'lost' }), 'nurture');
});

test('a nurture lead reopens into conversation and counts the return', () => {
  const row = { close_outcome: 'lost', close_note: 'Not now', closed_at: new Date(), status: 'resolved', pipeline_stage: 'new', reopen_count: 1 };
  assert.equal(reopenNurtureLead(row), true);
  assert.equal(row.close_outcome, '');
  assert.equal(row.close_note, '');
  assert.equal(row.closed_at, null);
  assert.equal(row.pipeline_stage, 'calling');
  assert.equal(row.status, 'contacted');
  assert.equal(row.reopen_count, 2);
  assert.ok(row.reopened_at instanceof Date);
  assert.equal(leadStatus(row), 'open');
});

test('only nurture leads reopen', () => {
  const joined = { close_outcome: 'won', pipeline_stage: 'ready' };
  assert.equal(reopenNurtureLead(joined), false);
  assert.equal(joined.close_outcome, 'won');
  const open = { close_outcome: '', pipeline_stage: 'new' };
  assert.equal(reopenNurtureLead(open), false);
  assert.equal(open.reopen_count, undefined);
});

test('chatbot leads with a visitor reply are in conversation', () => {
  const row = {
    source: 'landing_chat',
    status: 'pending',
    transcript: [
      { role: 'assistant', text: 'Hi, I am Ravi.' },
      { role: 'user', text: 'I need help with follow-up.' },
    ],
  };
  assert.equal(hasLiveConversation(row), true);
  assert.equal(deriveAdminPipelineStage(row), 'calling');
  assert.equal(resolveAdminPipelineStage(row), 'calling');
});

test('direct query stays in to-call until moved or contacted', () => {
  const row = {
    source: 'direct_inquiry',
    status: 'pending',
    message: 'Book a demo',
    transcript: [],
  };
  assert.equal(hasLiveConversation(row), false);
  assert.equal(deriveAdminPipelineStage(row), 'new');
});

test('next action distinguishes chatbot urgency and direct inquiry response', () => {
  assert.equal(recommendedAdminLeadAction({ source: 'landing_chat', lead_grade: 'hot', phone: '123' }).timing, 'Within 5 minutes of their latest chat');
  assert.equal(recommendedAdminLeadAction({ source: 'landing_chat', lead_grade: 'warm', phone: '123' }).timing, 'Within 30 minutes of their latest chat');
  assert.equal(recommendedAdminLeadAction({ source: 'direct_inquiry', phone: '123' }).timing, 'Within 30 minutes of the inquiry');
  assert.equal(recommendedAdminLeadAction({ source: 'direct_inquiry', phone: '' }).title, 'Reply by email');
  assert.equal(recommendedAdminLeadAction({ voice_outcome: 'callback' }).title, 'Honor the callback');
  assert.equal(recommendedAdminLeadAction({ voice_outcome: 'plan_recommended' }).title, 'Help them choose a plan');
});

test('joined leads stay ready to join and lost leads are closed', () => {
  assert.equal(resolveAdminPipelineStage({ pipeline_stage: 'calling', close_outcome: 'won' }), 'ready');
  assert.equal(resolveAdminPipelineStage({ pipeline_stage: 'calling', close_outcome: 'lost' }), 'closed');
});

test('manual pipeline stage wins over derived stage', () => {
  const row = {
    source: 'landing_chat',
    pipeline_stage: 'ready',
    status: 'contacted',
    transcript: [{ role: 'user', text: 'Tell me about plans' }],
  };
  assert.equal(resolveAdminPipelineStage(row), 'ready');
});

test('interested voice outcome is ready to join', () => {
  assert.equal(deriveAdminPipelineStage({ voice_outcome: 'interested', status: 'contacted' }), 'ready');
});

test('voice outcomes write the saved stage', () => {
  assert.deepEqual(fieldsForVoiceOutcome('interested', { pipeline_stage: 'new' }), { pipeline_stage: 'ready' });
  assert.deepEqual(fieldsForVoiceOutcome('plan_recommended', { pipeline_stage: 'calling' }), { pipeline_stage: 'ready' });
  assert.deepEqual(fieldsForVoiceOutcome('callback', { pipeline_stage: 'new' }), { pipeline_stage: 'calling' });
  assert.deepEqual(fieldsForVoiceOutcome('callback', { pipeline_stage: 'ready' }), {});
  const declined = fieldsForVoiceOutcome('declined', { pipeline_stage: 'calling' });
  assert.equal(declined.close_outcome, 'lost');
  assert.equal(declined.status, 'resolved');
  assert.ok(declined.closed_at instanceof Date);
});

test('auto stage does not pull a ready lead backwards', () => {
  const row = {
    source: 'landing_chat',
    pipeline_stage: 'ready',
    transcript: [{ role: 'user', text: 'Still thinking' }],
  };
  assert.equal(nextAutoPipelineStage(row), 'ready');
});
