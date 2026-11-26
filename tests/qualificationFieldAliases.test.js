/**
 * Qualification field alias map (question id ↔ stored field).
 * Keeps catalog ids and LeadProfile fields unchanged while centralizing read-side mapping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALIFICATION_FIELD_ALIASES,
  QUALIFICATION_STORED_TO_QUESTION,
  storedFieldForQuestionId,
  questionIdForStoredField,
  qualificationAliasKeys,
  readQualificationAlias,
  readQualificationAliasFrom,
} from '../services/professionalAssistant/qualificationFieldAliases.js';

test('qualification aliases: down_payment resolves both ways', () => {
  assert.equal(QUALIFICATION_FIELD_ALIASES.down_payment, 'down_payment_readiness');
  assert.equal(QUALIFICATION_STORED_TO_QUESTION.down_payment_readiness, 'down_payment');
  assert.equal(storedFieldForQuestionId('down_payment'), 'down_payment_readiness');
  assert.equal(questionIdForStoredField('down_payment_readiness'), 'down_payment');
  assert.deepEqual(qualificationAliasKeys('down_payment'), ['down_payment_readiness', 'down_payment']);
  assert.deepEqual(qualificationAliasKeys('down_payment_readiness'), ['down_payment_readiness', 'down_payment']);
});

test('qualification aliases: read prefers stored field then question id', () => {
  assert.equal(
    readQualificationAlias({ down_payment_readiness: 'ready_now', down_payment: 'other' }, 'down_payment'),
    'ready_now',
  );
  assert.equal(
    readQualificationAlias({ down_payment: 'within_30' }, 'down_payment'),
    'within_30',
  );
  assert.equal(
    readQualificationAlias({ down_payment_readiness: '20_plus' }, 'down_payment_readiness'),
    '20_plus',
  );
  assert.equal(
    readQualificationAlias({ down_payment: 'under_5' }, 'down_payment_readiness'),
    'under_5',
  );
  assert.equal(
    readQualificationAliasFrom(
      'down_payment',
      { down_payment_readiness: '' },
      { down_payment: 'ready_now' },
    ),
    'ready_now',
  );
  assert.equal(storedFieldForQuestionId('timeline'), 'timeline');
  assert.equal(questionIdForStoredField('timeline'), 'timeline');
});
