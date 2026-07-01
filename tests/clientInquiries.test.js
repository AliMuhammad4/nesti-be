import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeInquiryCounts,
  dedupeInquiryItemsForAllView,
} from '../services/client/clientInquiryService.js';

test('client inquiry service exposes list function', async () => {
  const { getClientInquiriesForUser } = await import('../services/client/clientInquiryService.js');
  assert.equal(typeof getClientInquiriesForUser, 'function');
});

test('dedupeInquiryItemsForAllView hides professional row when property inquiry shares thread', () => {
  const items = [
    { inquiry_type: 'property', thread_id: 'thread-1', id: 'property-1' },
    { inquiry_type: 'professional', thread_id: 'thread-1', id: 'professional-1' },
  ];

  const deduped = dedupeInquiryItemsForAllView(items);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].inquiry_type, 'property');
});

test('dedupeInquiryItemsForAllView keeps professional-only conversations', () => {
  const items = [
    { inquiry_type: 'property', thread_id: null, id: 'property-1' },
    { inquiry_type: 'professional', thread_id: 'thread-2', id: 'professional-1' },
  ];

  assert.equal(dedupeInquiryItemsForAllView(items).length, 2);
});

test('computeInquiryCounts uses deduped all-view totals', () => {
  const items = [
    { inquiry_type: 'property', thread_id: 'thread-1', id: 'property-1' },
    { inquiry_type: 'property', thread_id: null, id: 'property-2' },
    { inquiry_type: 'professional', thread_id: 'thread-1', id: 'professional-1' },
    { inquiry_type: 'professional', thread_id: 'thread-3', id: 'professional-2' },
  ];

  const counts = computeInquiryCounts(items);
  assert.deepEqual(counts, {
    total: 3,
    property: 2,
    professional: 2,
  });
});
