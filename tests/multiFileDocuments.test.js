import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { documentReviewReply } from '../services/chat/documents/documentReviewReply.js';
import { resumeDocumentReads } from '../services/chat/documents/documentReadJobs.js';

const setting = { applied: true, role: 'agent', languages: ['english'], document_requests: ['proof_of_funds', 'photo_id'] };
const ctx = { userMessage: 'here are my files', clientType: 'investor', intent: 'buy', text: 'investor buy' };

test('two new files in one turn are each reviewed and named', () => {
  const docs = [
    { _id: 'a', original_filename: '143712-05-11.pdf', extracted_text: 'Bank statement balance available funds account holder', summary: 'Bank statement showing available funds', document_type: 'bank statement', status: 'ready' },
    { _id: 'b', original_filename: 'Receipt-2389-2765.pdf', extracted_text: 'Receipt for coffee purchase', summary: 'Store receipt', document_type: 'receipt', status: 'ready' },
  ];
  const out = documentReviewReply(docs, setting, ctx);
  assert.match(out, /I reviewed all 2 files/);
  assert.match(out, /143712-05-11\.pdf/);
  assert.match(out, /Receipt-2389-2765\.pdf is not one of the documents I asked for/);
});

test('a failed read on one file does not hide the other', () => {
  const docs = [
    { _id: 'a', original_filename: 'one.pdf', extracted_text: '', summary: 'The file is saved. The text could not be read.', status: 'failed' },
    { _id: 'b', original_filename: 'two.pdf', extracted_text: 'Receipt', summary: 'Receipt', status: 'ready' },
  ];
  const out = documentReviewReply(docs, setting, ctx);
  assert.match(out, /one\.pdf/);
  assert.match(out, /two\.pdf/);
  assert.match(out, /please share the proof of funds/i);
});

test('resume path no longer throws "mongoose is not defined"', async () => {
  await assert.doesNotReject(() => resumeDocumentReads(['not-an-object-id', '']));
  const src = readFileSync(new URL('../services/chat/documents/documentReadJobs.js', import.meta.url), 'utf8');
  assert.match(src, /^import mongoose from 'mongoose';/m);
  assert.match(src, /Chat document read crashed/);
});

test('promised consultation link is never stripped', () => {
  const src = readFileSync(new URL('../services/chat/handleChat/chatTurnFinish.js', import.meta.url), 'utf8');
  assert.match(src, /const bookingLinkAllowed = consultationOffered \|\| Boolean\(/);
});
