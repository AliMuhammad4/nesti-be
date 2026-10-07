import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAdminPipelineStage,
  hasLiveConversation,
  nextAutoPipelineStage,
  resolveAdminPipelineStage,
} from '../services/admin/adminPipelineStage.js';

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

test('auto stage does not pull a ready lead backwards', () => {
  const row = {
    source: 'landing_chat',
    pipeline_stage: 'ready',
    transcript: [{ role: 'user', text: 'Still thinking' }],
  };
  assert.equal(nextAutoPipelineStage(row), 'ready');
});
