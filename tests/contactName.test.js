import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceContactIdentityFields,
  extractContactFromMessage,
  plausibleVisitorName,
} from '../services/chat/utils/contactUtils.js';

test('a sale sentence is not stored as the visitor name', () => {
  assert.equal(plausibleVisitorName('selling my'), null);
  assert.equal(extractContactFromMessage('I am selling my house').name, null);
  assert.equal(extractContactFromMessage('i am buying a condo').name, null);
  const contact = { name: 'selling my' };
  coerceContactIdentityFields(contact);
  assert.equal(contact.name, null);
});

test('a stated name is still kept', () => {
  assert.equal(extractContactFromMessage('my name is Bilal Khan').name, 'Bilal Khan');
  assert.equal(plausibleVisitorName('Ada'), 'Ada');
});
