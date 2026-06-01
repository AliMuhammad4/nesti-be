import crypto from 'crypto';
import mongoose from 'mongoose';
import InviteLink from '../../../models/InviteLink.js';
import User from '../../../models/User.js';
import ProfessionalProfile from '../../../models/ProfessionalProfile.js';

const TOKEN_BYTES = 24;
const MIN_TOKEN_LENGTH = 12;
const DEFAULT_ATTRIBUTION_DAYS = Number(process.env.INVITE_ATTRIBUTION_DAYS || 90);

export function isValidInviteToken(rawToken) {
  return Boolean(rawToken && String(rawToken).trim().length >= MIN_TOKEN_LENGTH);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function hashFingerprint(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

export function generateInviteToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function buildInviteUrl(rawToken) {
  const base = (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_FRONTEND_URL ||
    ''
  ).replace(/\/+$/, '');
  return base ? `${base}/invite/${rawToken}` : `/invite/${rawToken}`;
}

export function safeUrl(urlLike = '') {
  try {
    return new URL(String(urlLike || '').trim()).origin;
  } catch {
    return '';
  }
}

export function normalizeSessionId(v) {
  return String(v || '').trim().slice(0, 128);
}

export function normalizeVisitorId(v) {
  return String(v || '').trim().slice(0, 128);
}

export function normalizeChannel(channel) {
  const raw = String(channel || 'direct').trim().toLowerCase();
  return raw || 'direct';
}

export function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export function attributionWindowDays(days) {
  const n = Number(days || DEFAULT_ATTRIBUTION_DAYS);
  const fallback = Number.isFinite(n) ? n : DEFAULT_ATTRIBUTION_DAYS;
  return Math.max(30, Math.min(90, Math.round(fallback)));
}

export function clampWindowDays(days, { min = 1, max = 365, fallback = 30 } = {}) {
  return Math.min(Math.max(Number(days) || fallback, min), max);
}

export function sinceDaysAgo(days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

export function serializeInviteLink(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  if (!d?._id) return null;
  return {
    id: String(d._id),
    inviter_user_id: d.inviter_user_id ? String(d.inviter_user_id) : '',
    intended_role: d.intended_role || '',
    intended_audience: d.intended_audience || 'any',
    source_channel: d.source_channel || 'direct',
    source_referral_id: d.source_referral_id ? String(d.source_referral_id) : null,
    source_conversation_id: d.source_conversation_id ? String(d.source_conversation_id) : null,
    share_url: String(d?.metadata?.share_url || '').trim() || '',
    is_active: Boolean(d.is_active),
    expires_at: d.expires_at || null,
    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,
  };
}

export function serializeAttribution(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  if (!d?._id) return null;
  return {
    id: String(d._id),
    invite_link_id: d.invite_link_id ? String(d.invite_link_id) : '',
    session_id: d.session_id || '',
    visitor_id: d.visitor_id || '',
    source_channel: d.source_channel || 'direct',
    status: d.status || 'pending',
    first_clicked_at: d.first_clicked_at || null,
    last_clicked_at: d.last_clicked_at || null,
    expires_at: d.expires_at || null,
    consumed_by_user_id: d.consumed_by_user_id ? String(d.consumed_by_user_id) : null,
    consumed_at: d.consumed_at || null,
  };
}

export async function getInviterPreview(inviter_user_id) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) return null;
  const inviter = await User.findById(inviter_user_id)
    .select('first_name last_name email role profile_image')
    .lean();
  if (!inviter) return null;
  const pro = await ProfessionalProfile.findOne({ user_id: inviter._id })
    .select('full_name company_name professional_type')
    .lean();
  const fallbackName = [inviter.first_name, inviter.last_name].filter(Boolean).join(' ').trim();
  return {
    id: String(inviter._id),
    full_name: String(pro?.full_name || fallbackName || inviter.email || '').trim(),
    first_name: inviter.first_name || '',
    last_name: inviter.last_name || '',
    email: inviter.email || '',
    role: inviter.role || pro?.professional_type || '',
    profile_image: inviter.profile_image || null,
    company_name: pro?.company_name || '',
  };
}

function inviteIsExpired(invite) {
  return !invite?.is_active || (invite.expires_at && new Date(invite.expires_at) < new Date());
}

export async function loadInviteByToken(rawToken, { requireActive = true } = {}) {
  if (!isValidInviteToken(rawToken)) {
    return { ok: false, code: 400, message: 'Invalid invite token' };
  }
  const token_hash = hashToken(rawToken);
  const invite = await InviteLink.findOne({ token_hash }).lean();
  if (!invite) return { ok: false, code: 404, message: 'Invite not found' };
  if (requireActive && inviteIsExpired(invite)) {
    return { ok: false, code: 410, message: 'Invite has expired' };
  }
  return { ok: true, invite, token_hash };
}
