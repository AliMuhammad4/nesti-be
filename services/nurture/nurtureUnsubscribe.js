import crypto from 'crypto';
import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import logger from '../../utils/logger.js';

/**
 * Signed opt-out links for follow-up (nurture) emails. Token = "<leadMatchId>.<hmac>", so it needs no
 * stored row and cannot be guessed for another lead.
 */
function secret() {
  return String(process.env.NURTURE_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || '').trim();
}

function signature(leadMatchId) {
  const key = secret();
  if (!key) return '';
  return crypto.createHmac('sha256', key).update(`nurture-unsubscribe:${leadMatchId}`).digest('base64url').slice(0, 32);
}

export function nurtureUnsubscribeToken(leadMatchId) {
  const id = String(leadMatchId || '').trim();
  const sig = id ? signature(id) : '';
  return sig ? `${id}.${sig}` : '';
}

export function verifyNurtureUnsubscribeToken(token) {
  const [id, sig] = String(token || '').trim().split('.');
  if (!id || !sig || !mongoose.Types.ObjectId.isValid(id)) return null;
  const expected = signature(id);
  if (!expected || expected.length !== sig.length) return null;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? id : null;
}

function frontendBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
}

export function nurtureUnsubscribeUrl(leadMatchId) {
  const token = nurtureUnsubscribeToken(leadMatchId);
  if (!token) return '';
  const path = `/followups/unsubscribe?token=${encodeURIComponent(token)}`;
  const base = frontendBaseUrl();
  return base ? `${base}${path}` : '';
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Adds the opt-out line to the plain text and HTML of a follow-up email. */
export function withNurtureUnsubscribeFooter({ message = '', htmlMessage = '' } = {}, leadMatchId) {
  const url = leadMatchId ? nurtureUnsubscribeUrl(leadMatchId) : '';
  const text = url
    ? `Don't want these follow-up emails? Unsubscribe: ${url}`
    : "Don't want these follow-up emails? Reply to this email to stop them.";
  const html = url
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;font-family:Arial,sans-serif;">Don't want these follow-up emails? <a href="${escapeAttr(url)}" style="color:#1F6F4A;">Unsubscribe</a>.</p>`
    : `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;font-family:Arial,sans-serif;">Don't want these follow-up emails? Reply to this email to stop them.</p>`;
  const plain = String(message || '').trim();
  const rich = String(htmlMessage || '').trim();
  let nextHtml = rich;
  if (rich) {
    nextHtml = /<\/body>/i.test(rich) ? rich.replace(/<\/body>/i, `${html}</body>`) : `${rich}${html}`;
  }
  return {
    message: plain ? `${plain}\n\n${text}` : text,
    htmlMessage: nextHtml,
    unsubscribeUrl: url,
  };
}

export function leadOptedOutOfNurture(leadMatch) {
  return Boolean(leadMatch?.nurture_opted_out);
}

/** Marks the lead (and the same client's other matches with this professional) as opted out. */
export async function optOutOfNurtureByToken(token) {
  const id = verifyNurtureUnsubscribeToken(token);
  if (!id) return false;
  const lead = await LeadMatch.findById(id).select('_id user_id lead_profile_id').lean();
  if (!lead) return false;
  const filter = lead.lead_profile_id
    ? { user_id: lead.user_id, lead_profile_id: lead.lead_profile_id }
    : { _id: lead._id };
  await LeadMatch.updateMany(filter, { $set: { nurture_opted_out: true, nurture_opted_out_at: new Date() } });
  logger.info('nurture follow-up opt-out', { lead_match_id: String(lead._id) });
  return true;
}
