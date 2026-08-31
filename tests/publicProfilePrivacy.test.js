import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeFullPublicProfile } from '../services/publicProfile/publicProfileReadService.js';

test('public profile serialization never turns CRM leads into testimonials', () => {
  const profile = {
    _id: 'profile-1',
    slug: 'lawyer-one',
    professional_type: 'lawyer',
    enabled: true,
    user_id: {
      _id: 'user-1',
      first_name: 'Lawyer',
      last_name: 'One',
      email: 'lawyer@example.com',
    },
    stats: { transactions_closed: 12, years_practice: 7 },
    testimonials: [{
      client_name: 'Approved testimonial',
      rating: 4,
      text: 'Approved by the profile owner.',
      date: '2026-01-01',
    }],
    feedback_submissions: [
      {
        _id: 'approved-feedback',
        client_name: 'Approved feedback',
        email: 'private-approved@example.com',
        rating: 5,
        text: 'Explicitly approved.',
        approved: true,
        submitted_at: '2026-02-01',
      },
      {
        _id: 'pending-feedback',
        client_name: 'Pending feedback',
        email: 'private-pending@example.com',
        rating: 1,
        text: 'Must stay private.',
        approved: false,
        submitted_at: '2026-03-01',
      },
    ],
  };
  const context = {
    recentLeads: [{
      identity: { full_name: 'Private CRM lead' },
      property: { address: 'Private address' },
    }],
    dashboardKpis: null,
    closedSellerLeadsCount: 99,
    availableSellerLeadsCount: 88,
    recentClosedSellerLeads: [{ address: 'Private CRM address' }],
    sellerCredentialMetrics: null,
    professionalCredentialMetrics: {
      active_pipeline_value: 999999,
      total_clients: 500,
      closed_cases: 400,
    },
    professionalProfile: {
      experience: '7 years',
      location: 'Toronto',
    },
  };

  const serialized = serializeFullPublicProfile(profile, 'user-1', context);

  assert.deepEqual(serialized.real_clients, []);
  assert.equal(serialized.testimonials.length, 2);
  assert.equal(serialized.testimonials.some((item) => item.client_name === 'Pending feedback'), false);
  assert.equal(JSON.stringify(serialized).includes('Private CRM'), false);
  assert.equal(JSON.stringify(serialized).includes('private-pending@example.com'), false);
  assert.equal('recent_closed_seller_leads' in serialized, false);
  assert.deepEqual(serialized.professional_credential_metrics, {
    active_pipeline_value: 999999,
    total_clients: 500,
    closed_cases: 400,
    currency: '',
  });
  assert.equal(serialized.client_rating_average, 4.5);
});
