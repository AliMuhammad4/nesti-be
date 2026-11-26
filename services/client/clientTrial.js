import { USER_ROLE } from '../../constants/roles.js';

/** One free trial per client account, started when the account is created (email verify or Google). */
export const CLIENT_TRIAL_DAYS = 3;
/** Trial access mirrors the entry client plan, like the professional trial uses Basic. */
export const CLIENT_TRIAL_TIER = 'essential';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_BLOCKING_STATUSES = new Set(['past_due', 'unpaid']);

export function newClientTrialFields(now = new Date()) {
  return {
    client_trial_started_at: now,
    client_trial_ends_at: new Date(now.getTime() + CLIENT_TRIAL_DAYS * DAY_MS),
  };
}

export function clientTrialEndsAt(user) {
  const raw = user?.client_trial_ends_at;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * True while a client's signup trial is running. A plan the client bought always wins
 * (callers check it first); a past-due or unpaid plan stays locked (no trial fallback).
 */
export function isClientTrialActive(user, clientSubscription = null, now = Date.now()) {
  if (!user || user.role !== USER_ROLE.CLIENT) return false;
  const status = String(clientSubscription?.status || '').trim().toLowerCase();
  if (TRIAL_BLOCKING_STATUSES.has(status)) return false;
  const endsAt = clientTrialEndsAt(user);
  return Boolean(endsAt && endsAt.getTime() > now);
}
