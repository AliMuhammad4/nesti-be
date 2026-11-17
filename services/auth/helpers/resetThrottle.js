import crypto from 'crypto';
import mongoose from 'mongoose';

/**
 * Small hourly counters for the password reset flow, keyed by a hash of the email (and the
 * connection), so the same limits apply to every email whether or not an account exists.
 * Emails are never stored in plain text here; rows expire on their own.
 */
const COLLECTION = 'password_reset_throttles';
let indexPromise = null;

function throttleCollection() {
  // No database connection (unit tests with stubbed models): skip the counters.
  if (mongoose.connection.readyState !== 1) return null;
  const collection = mongoose.connection.collection(COLLECTION);
  indexPromise ||= collection
    .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
    .catch(() => {
      indexPromise = null;
    });
  return collection;
}

const hashKey = (kind, parts) =>
  `${kind}:${crypto.createHash('sha256').update(parts.map((part) => String(part || '')).join('|')).digest('hex')}`;

export const requesterKey = (kind, email, ip) => hashKey(kind, [email, ip || 'unknown']);
export const emailKey = (kind, email) => hashKey(kind, [email]);

const EMPTY = { count: 0, windowEndsAt: null, lastAt: null };

/** The live window's count, its end, and the last time it was bumped (count 0 when none). */
export async function readCounter(id, now = new Date()) {
  const collection = throttleCollection();
  if (!collection) return EMPTY;
  const row = await collection.findOne({ _id: id });
  if (!row?.expires_at || new Date(row.expires_at) <= now) return EMPTY;
  return {
    count: Number(row.count || 0),
    windowEndsAt: new Date(row.expires_at),
    lastAt: row.last_at ? new Date(row.last_at) : null,
  };
}

/** Adds one; a fresh window starts when the previous one has ended. */
export async function bumpCounter(id, windowMs, now = new Date()) {
  const collection = throttleCollection();
  if (!collection) return;
  const windowEnd = new Date(now.getTime() + windowMs);
  const live = { $gt: ['$expires_at', now] };
  await collection.updateOne(
    { _id: id },
    [
      {
        $set: {
          count: { $cond: [live, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1] },
          expires_at: { $cond: [live, '$expires_at', windowEnd] },
          last_at: now,
        },
      },
    ],
    { upsert: true },
  );
}
