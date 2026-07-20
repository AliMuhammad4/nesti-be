import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';

const defaultMessage = 'Too many requests. Please try again shortly.';
let limiterStoreSequence = 0;

class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.windowMs = 60_000;
    this.localKeys = false;
    this.indexPromise = null;
  }

  init(options) {
    this.windowMs = Number(options?.windowMs || this.windowMs);
  }

  collection() {
    const collection = mongoose.connection.collection('http_rate_limits');
    this.indexPromise ||= collection
      .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
      .catch(() => null);
    return collection;
  }

  async increment(key) {
    const now = new Date();
    const resetTime = new Date(now.getTime() + this.windowMs);
    const document = await this.collection().findOneAndUpdate(
      { _id: `${this.prefix}:${key}` },
      [
        {
          $set: {
            count: {
              $cond: [
                { $gt: ['$expires_at', now] },
                { $add: [{ $ifNull: ['$count', 0] }, 1] },
                1,
              ],
            },
            expires_at: {
              $cond: [{ $gt: ['$expires_at', now] }, '$expires_at', resetTime],
            },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    const value = document?.value || document;
    return {
      totalHits: Number(value?.count || 1),
      resetTime: new Date(value?.expires_at || resetTime),
    };
  }

  async decrement(key) {
    await this.collection().updateOne(
      { _id: `${this.prefix}:${key}`, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  }

  async resetKey(key) {
    await this.collection().deleteOne({ _id: `${this.prefix}:${key}` });
  }
}

function normalizeEmailFromRequest(req) {
  const bodyEmail = String(req?.body?.email || '').trim().toLowerCase();
  if (bodyEmail) return bodyEmail;
  const queryEmail = String(req?.query?.email || '').trim().toLowerCase();
  if (queryEmail) return queryEmail;
  return '';
}

function resolveClientIp(req) {
  return String(req?.ip || req?.socket?.remoteAddress || 'unknown').trim().toLowerCase() || 'unknown';
}

function authKeyByIp(req) {
  return `ip:${resolveClientIp(req)}`;
}

function authKeyByEmailAndIp(req) {
  const email = normalizeEmailFromRequest(req);
  const ip = resolveClientIp(req);
  if (!email) return `ip:${ip}`;
  return `email:${email}|ip:${ip}`;
}

function authKeyByUserOrIp(req) {
  const userId = String(req?.user?._id || '').trim();
  if (userId) return `user:${userId}`;
  return `ip:${resolveClientIp(req)}`;
}

const buildLimiter = ({
  windowMs,
  max,
  message = defaultMessage,
  keyGenerator = authKeyByIp,
  shared = false,
}) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    ...(shared
      ? { store: new MongoRateLimitStore(`limiter-${limiterStoreSequence += 1}`) }
      : {}),
  });

// Broad limiter for all auth routes.
export const authGlobalLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many auth requests from this IP. Please try again later.',
  keyGenerator: authKeyByIp,
});

// Sensitive auth actions (signup/login/reset/otp resend).
export const authSensitiveLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
  message: 'Too many attempts. Please wait a few minutes and try again.',
  keyGenerator: authKeyByEmailAndIp,
});

// OTP verification can happen multiple times in short bursts.
export const authOtpVerifyLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: 'Too many OTP verification attempts. Please wait and retry.',
  keyGenerator: authKeyByEmailAndIp,
});

// Authenticated auth endpoints should rate-limit per user, not shared IP.
export const authUserLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: 'Too many account requests. Please wait and try again.',
  keyGenerator: authKeyByUserOrIp,
});

export const callTokenLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many call attempts. Please wait a moment and try again.',
  keyGenerator: authKeyByUserOrIp,
  shared: true,
});

export const callArtifactReadLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many call note requests. Please wait a moment and try again.',
  keyGenerator: authKeyByUserOrIp,
  shared: true,
});
