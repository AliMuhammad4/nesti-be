import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountReinstatedMail,
  buildAccountSuspendedMail,
  renderAccountReinstatedEmailHtml,
  renderAccountSuspendedEmailHtml,
} from '../services/admin/accountStatusNotifications.js';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../constants/accountStatus.js';

test('suspended account email includes the reason and does not interpolate raw HTML', () => {
  const html = renderAccountSuspendedEmailHtml({
    firstName: 'Alex',
    reason: '<script>alert(1)</script>',
  });
  assert.match(html, /Hi Alex,/);
  assert.match(html, /Your account is suspended/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
});

test('login copy tells the user the account is suspended', () => {
  assert.match(ACCOUNT_SUSPENDED_MESSAGE, /account is suspended/i);
});

test('suspend mail is addressed to the professional and includes the admin reason', () => {
  const mail = buildAccountSuspendedMail({
    email: '  Agent@Example.com ',
    firstName: 'Muhammad',
    reason: 'Documents could not be verified',
  });
  assert.equal(mail.email, 'agent@example.com');
  assert.match(mail.subject, /suspended/i);
  assert.match(mail.message, /Hi Muhammad,/);
  assert.match(mail.message, /Reason provided: Documents could not be verified/);
  assert.match(mail.htmlMessage, /Reason provided/);
  assert.match(mail.htmlMessage, /Documents could not be verified/);
});

test('reinstated account email tells the professional they can sign in again', () => {
  const html = renderAccountReinstatedEmailHtml({ firstName: 'Alex' });
  assert.match(html, /Hi Alex,/);
  assert.match(html, /reinstated/i);
  assert.match(html, /sign in again/i);

  const mail = buildAccountReinstatedMail({
    email: '  Agent@Example.com ',
    firstName: 'Muhammad',
  });
  assert.equal(mail.email, 'agent@example.com');
  assert.match(mail.subject, /reinstated/i);
  assert.match(mail.message, /Hi Muhammad,/);
  assert.match(mail.message, /sign in again/i);
});
