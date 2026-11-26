import test from 'node:test';
import assert from 'node:assert/strict';
import { disposableEmailRules, isDisposableEmail } from '../services/auth/disposableEmailGuard.js';

test('blocks Mailinator and disposable email domains', () => {
  assert.equal(isDisposableEmail('test@mailinator.com'), true);
  assert.equal(isDisposableEmail('test@inbox.mailinator.com'), true);
  assert.equal(isDisposableEmail('test@tempmail.com'), true);
  assert.equal(isDisposableEmail('test@temp-mail.org'), true);
  assert.equal(isDisposableEmail('test@10minutemail.com'), true);
});

test('allows normal business and personal domains', () => {
  assert.equal(isDisposableEmail('agent@examplebrokerage.com'), false);
  assert.equal(isDisposableEmail('person@gmail.com'), false);
  assert.equal(isDisposableEmail('user@outlook.com'), false);
});

test('exposes the same rules the signup form fetches', () => {
  const rules = disposableEmailRules();
  assert.ok(rules.domains.includes('mailinator.com'));
  assert.ok(rules.keywords.includes('tempmail'));
  assert.match(rules.message, /disposable/i);
});
