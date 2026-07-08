import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveLawyerQualificationFromText,
  scoreLawyerLead,
} from '../services/chat/scoring/lawyerScoring.js';
import {
  buildClientProfileSnapshot,
  normalizeLawyerInquiryBody,
  resolveLawyerQualification,
  validateLawyerInquiryInput,
  submitClientLawyerInquiry,
} from '../services/client/clientProfessionalInquiryService.js';

test('client professional inquiry service exports submit function', () => {
  assert.equal(typeof submitClientLawyerInquiry, 'function');
});

test('normalizeLawyerInquiryBody trims and maps location field', () => {
  const payload = normalizeLawyerInquiryBody({
    message: ' Need help with closing ',
    transaction_type: 'home_purchase',
    closing_timeline: '30_60_days',
    legal_services_needed: 'full_closing',
    location: ' Downtown ',
  });

  assert.equal(payload.message, 'Need help with closing');
  assert.equal(payload.property_address, 'Downtown');
});

test('validateLawyerInquiryInput enforces required minimal fields', () => {
  assert.equal(validateLawyerInquiryInput({}), 'Please enter your question.');
  assert.equal(
    validateLawyerInquiryInput({
      message: 'Need legal advice',
      transaction_type: '',
      closing_timeline: '30_60_days',
      legal_services_needed: 'full_closing',
    }),
    'Transaction type is required.',
  );
  assert.equal(
    validateLawyerInquiryInput({
      message: 'Need legal advice',
      transaction_type: 'home_purchase',
      closing_timeline: '30_60_days',
      legal_services_needed: 'full_closing',
    }),
    '',
  );
});

test('resolveLawyerQualification infers missing fields from client profile', () => {
  const resolved = resolveLawyerQualification(
    {
      message: 'I am buying my first home and closing in 30 days',
      transaction_type: '',
      closing_timeline: '',
      property_value: '',
      legal_services_needed: 'full_closing',
    },
    {
      purchase_timeline: 'asap',
      dream_home_price: 680_000,
      mortgage_status: 'fully_pre_approved',
      realtor_status: 'no_agent',
      preferred_contact_method: 'email',
      home_goals: ['first_time_buyer'],
    },
  );

  assert.equal(resolved.transaction_type, 'home_purchase');
  assert.equal(resolved.closing_timeline, 'within_30_days');
  assert.equal(resolved.property_value, '400k_700k');
  assert.equal(resolved.mortgage_status, 'fully_approved');
  assert.equal(resolved.first_time_buyer, 'yes');
  assert.equal(resolved.legal_services_needed, 'full_closing');
});

test('resolved qualification feeds lawyer scoring model', () => {
  const qualification = resolveLawyerQualification(
    {
      message: 'Offer accepted and need full closing support within 30 days',
      transaction_type: 'home_purchase',
      closing_timeline: 'within_30_days',
      property_value: '700k_1m',
      legal_services_needed: 'full_closing',
    },
    {
      mortgage_status: 'fully_pre_approved',
      realtor_status: 'has_agent',
      home_goals: ['first_time_buyer'],
    },
  );

  const scored = scoreLawyerLead({
    message: 'Offer accepted and need full closing support within 30 days',
    hasContact: true,
    contactInfo: { name: 'Client', email: 'client@example.com', phone: '' },
    interactionCount: 1,
    seedSignals: {},
    formQualification: qualification,
  });

  assert.ok(scored.leadScore >= 60);
  assert.ok(['warm', 'hot'].includes(scored.leadGrade));
});

test('expanded lawyer legal service values are recognized and scored', () => {
  const derived = deriveLawyerQualificationFromText(
    'I need agreement review before closing and mortgage document review as well',
  );
  assert.equal(derived.legal_services_needed, 'agreement_review');

  const scored = scoreLawyerLead({
    message: 'Need agreement review for a real estate purchase',
    hasContact: true,
    contactInfo: { name: 'Client', email: 'client@example.com', phone: '' },
    interactionCount: 1,
    seedSignals: {},
    formQualification: {
      transaction_stage: 'actively_submitting',
      closing_timeline: '30_60_days',
      transaction_type: 'home_purchase',
      property_value: '400k_700k',
      mortgage_status: 'conditional_approval',
      realtor_involved: 'yes',
      first_time_buyer: 'yes',
      legal_services_needed: 'agreement_review',
    },
  });

  assert.ok(scored.leadScore >= 60);
  assert.ok(scored.leadMeta.lead_reasons.includes('Legal services: agreement / contract review'));
});

test('buildClientProfileSnapshot returns compact inquiry-safe profile metadata', () => {
  const snapshot = buildClientProfileSnapshot({
    preferred_location: 'Toronto',
    preferred_locations: ['Toronto', 'Mississauga'],
    purchase_timeline: '1-3 months',
    dream_home_price: 750000,
    mortgage_status: 'fully_pre_approved',
    realtor_status: 'has_agent',
    offer_readiness: 'ready',
    home_goals: ['first_time_buyer'],
    annual_income: 120000,
    employment_status: 'full_time',
  });

  assert.equal(snapshot.preferred_location, 'Toronto');
  assert.deepEqual(snapshot.preferred_locations, ['Toronto', 'Mississauga']);
  assert.equal(snapshot.dream_home_price, 750000);
  assert.equal(snapshot.employment_status, 'full_time');
});
