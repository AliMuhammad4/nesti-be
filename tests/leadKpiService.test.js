import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSellerCredentialMetrics } from '../services/analytics/leadKpiService.js';

test('summarizeSellerCredentialMetrics returns distinct clients and seller property values', () => {
  const rows = [
    {
      _id: 'match-active-1',
      match_status: 'new',
      lead_profile_id: {
        _id: 'profile-1',
        budget_profile: { min_budget: 400000, max_budget: 600000, currency: 'USD' },
      },
    },
    {
      _id: 'match-active-duplicate',
      match_status: 'nurturing',
      lead_profile_id: {
        _id: 'profile-1',
        budget_profile: { min_budget: 400000, max_budget: 600000, currency: 'USD' },
      },
    },
    {
      _id: 'match-sold-actual',
      match_status: 'converted',
      compatibility_factors: { close_summary: { value: 750000 } },
      lead_profile_id: {
        _id: 'profile-2',
        property: { expected_price: '$700,000' },
      },
    },
    {
      _id: 'match-sold-estimated',
      match_status: 'converted',
      lead_profile_id: {
        _id: 'profile-3',
        property: { expected_price: '$1.2m' },
      },
    },
    {
      _id: 'match-lost',
      match_status: 'closed_lost',
      lead_profile_id: {
        _id: 'profile-4',
        property: { expected_price: '$900,000' },
      },
    },
  ];

  assert.deepEqual(summarizeSellerCredentialMetrics(rows), {
    total_clients: 4,
    active_pipeline_value: 500000,
    total_sold_home_value: 1950000,
    sold_homes_with_value: 2,
    sold_homes_with_closed_value: 1,
    currency: 'USD',
  });
});

test('summarizeSellerCredentialMetrics returns stable zero values for empty data', () => {
  assert.deepEqual(summarizeSellerCredentialMetrics([]), {
    total_clients: 0,
    active_pipeline_value: 0,
    total_sold_home_value: 0,
    sold_homes_with_value: 0,
    sold_homes_with_closed_value: 0,
    currency: 'USD',
  });
});
