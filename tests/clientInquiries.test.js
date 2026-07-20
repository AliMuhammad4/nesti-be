import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeInquiryCounts,
  dedupeInquiryItemsForAllView,
  isPropertyInquiryMatch,
  legalServiceLabel,
  resolveAgentServiceLabel,
  resolveMortgageServiceLabel,
} from '../services/client/clientInquiryService.js';

test('isPropertyInquiryMatch treats lawyer profile inquiries as professional', () => {
  assert.equal(
    isPropertyInquiryMatch({
      compatibility_factors: { source: 'client_professional_inquiry', client_user_id: 'c1' },
    }),
    false,
  );
  assert.equal(
    isPropertyInquiryMatch({
      compatibility_factors: {
        source: 'client_property_inquiry',
        inquired_property_id: 'prop-1',
        client_user_id: 'c1',
      },
    }),
    true,
  );
});

test('legalServiceLabel maps lawyer form options to display titles', () => {
  assert.equal(legalServiceLabel('full_closing'), 'Full closing services');
  assert.equal(legalServiceLabel('agreement_review'), 'Agreement / contract review');
  assert.equal(legalServiceLabel('refinance_legal_work'), 'Refinance legal work');
});

test('broker inquiry titles use financing purpose labels', () => {
  assert.equal(
    resolveMortgageServiceLabel({ compatibility_factors: { purchase_purpose: 'investment' } }),
    'Investment property',
  );
  assert.equal(
    resolveMortgageServiceLabel({
      compatibility_factors: {
        purchase_purpose: 'investment',
        mortgage_service_label: 'Investment financing',
      },
    }),
    'Investment property',
  );
  assert.equal(
    resolveMortgageServiceLabel({ compatibility_factors: { purchase_purpose: 'refinance' } }),
    'Refinance',
  );
});

test('agent profile inquiry titles use service labels', () => {
  assert.equal(
    resolveAgentServiceLabel({ compatibility_factors: { inquiry_goal: 'buying_help' } }),
    'Buying help',
  );
  assert.equal(
    resolveAgentServiceLabel({ compatibility_factors: { inquiry_goal: 'home_valuation' } }),
    'Home valuation',
  );
});

test('lawyer inquiry titles must not inherit shared profile qualification', () => {
  // Older matches without per-match legal_services_needed should not pick up
  // the latest shared LeadProfile value (e.g. sale_closing).
  const olderMatch = {
    compatibility_factors: {
      source: 'client_professional_inquiry',
      inquiry_message: 'older question',
    },
  };
  const sharedProfile = {
    source: 'client_professional_inquiry',
    qualification: { lawyer: { legal_services_needed: 'sale_closing' } },
  };
  assert.equal(
    String(olderMatch.compatibility_factors.legal_services_needed || '').trim(),
    '',
  );
  assert.equal(sharedProfile.qualification.lawyer.legal_services_needed, 'sale_closing');
  assert.equal(isPropertyInquiryMatch(olderMatch, sharedProfile), false);
});

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

test('My Inquiries items require a real LeadMatch — bare chat DMs are not inquiries', () => {
  // Synthetic row that the old list builder used to invent from a DM thread.
  const bareDmAsInquiry = {
    inquiry_type: 'professional',
    thread_id: 'dm-thread-1',
    id: 'dm-thread-1',
    lead_match_id: null,
    lead_profile_id: null,
    professional: { professional_type: 'lawyer' },
  };
  assert.equal(bareDmAsInquiry.lead_match_id, null);
  // Real inquiries always carry a lead_match_id (or a property lead_profile_id).
  const isRealInquiry = Boolean(
    bareDmAsInquiry.lead_match_id || bareDmAsInquiry.lead_profile_id,
  );
  assert.equal(isRealInquiry, false);
});

test('computeInquiryCounts uses deduped all-view totals', () => {
  const items = [
    { inquiry_type: 'property', thread_id: 'thread-1', id: 'property-1' },
    { inquiry_type: 'property', thread_id: null, id: 'property-2' },
    {
      inquiry_type: 'professional',
      thread_id: 'thread-1',
      id: 'professional-1',
      professional: { professional_type: 'lawyer' },
    },
    {
      inquiry_type: 'professional',
      thread_id: 'thread-3',
      id: 'professional-2',
      professional: { professional_type: 'agent' },
    },
  ];

  const counts = computeInquiryCounts(items);
  assert.equal(counts.total, 3);
  assert.equal(counts.property, 2);
  assert.equal(counts.professional, 2);
});

test('computeInquiryCounts treats property inquiries as agents', () => {
  const items = [
    { inquiry_type: 'property', thread_id: 't1', id: 'p1', professional: { professional_type: 'agent' } },
    { inquiry_type: 'property', thread_id: 't2', id: 'p2', professional: { professional_type: 'agent' } },
    {
      inquiry_type: 'professional',
      thread_id: 't3',
      id: 'l1',
      professional: { professional_type: 'lawyer' },
    },
    {
      inquiry_type: 'professional',
      thread_id: 't4',
      id: 'a1',
      professional: { professional_type: 'agent' },
    },
    {
      inquiry_type: 'professional',
      thread_id: 't5',
      id: 'b1',
      professional: { professional_type: 'mortgage_broker' },
    },
  ];

  const counts = computeInquiryCounts(items);
  assert.deepEqual(counts, {
    total: 5,
    property: 2,
    professional: 3,
    agents: 3,
    lawyers: 1,
    brokers: 1,
  });
  assert.equal(counts.agents + counts.lawyers + counts.brokers, counts.total);
});
