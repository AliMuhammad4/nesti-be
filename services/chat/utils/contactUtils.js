import crypto from 'crypto';
import Visitor from '../../../models/Visitor.js';
import ChatMessage from '../../../models/ChatMessage.js';

// ─── Visitor Resolution ────────────────────────────────────────────────────────

export const resolveVisitor = async ({ visitorUuid, embedToken, userAgent, clientIp }) => {
  if (visitorUuid) {
    const existing = await Visitor.findOne({ uuid: visitorUuid });
    if (existing) {
      existing.last_seen_at = new Date();
      if (userAgent)  existing.user_agent  = userAgent;
      if (clientIp)   existing.client_ip   = clientIp;
      if (embedToken) existing.embed_token = embedToken;
      await existing.save();
      return existing;
    }
  }

  const uuid = visitorUuid || crypto.randomBytes(8).toString('hex');
  return Visitor.create({
    uuid,
    embed_token: embedToken || null,
    user_agent:  userAgent  || null,
    client_ip:   clientIp   || null,
  });
};

// ─── Contact Extraction ────────────────────────────────────────────────────────

const EMAIL_RE   = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const PHONE_RE   = /(\+?\d[\d\s\-().]{7,}\d)/;
const ADDRESS_RE = /\b\d{1,5}\s+[A-Za-z0-9\s,.']+(?:street|st|avenue|ave|road|rd|blvd|boulevard|drive|dr|lane|ln|way|court|ct|place|pl)\b/i;
const NAME_RE    = /(?:i['']?m|my name is|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;

/**
 * Extract contact fields from a single message string using regex heuristics.
 */
export const extractContactFromMessage = (message = '') => ({
  email:   (String(message).match(EMAIL_RE)   || [])[0]?.toLowerCase() || null,
  phone:   (String(message).match(PHONE_RE)   || [])[1]?.replace(/\s+/g, '') || null,
  name:    (String(message).match(NAME_RE)    || [])[1]?.trim() || null,
  address: (String(message).match(ADDRESS_RE) || [])[0]?.trim() || null,
});

/**
 * Merge two contact objects. Existing non-null values are never overwritten.
 */
export const mergeContact = (base, patch) => ({
  email:   patch?.email   || base.email   || null,
  phone:   patch?.phone   || base.phone   || null,
  name:    patch?.name    || base.name    || null,
  address: patch?.address || base.address || null,
});

/**
 * Intake form shape after `mergeFormContactData(conversation.form_data, formContact)`.
 * Same contract as `lawyer.html` → `startChat` / `sendMessage`: the opening POST sends full `formContact`;
 * later messages may omit fields, so we always stamp user `meta.contact` from this merged object.
 */
export function contactPatchFromMergedForm(mergedFormContact) {
  const f = mergedFormContact && typeof mergedFormContact === 'object' ? mergedFormContact : {};
  const rawName = f.name || f.full_name || f.fullName;
  return {
    name: rawName ? String(rawName).trim() : null,
    email: f.email ? String(f.email).toLowerCase().trim() : null,
    phone: f.phone != null && String(f.phone).trim() ? String(f.phone).replace(/\s+/g, '').trim() : null,
    address: f.address != null && String(f.address).trim() ? String(f.address).trim() : null,
  };
}

/** Unify AI/meta aliases so CRM `hasContact` and LeadProfile names stay consistent. */
export function coerceContactIdentityFields(contactInfo) {
  if (!contactInfo || typeof contactInfo !== 'object') return contactInfo;
  const rawName = contactInfo.name || contactInfo.full_name || contactInfo.fullName;
  if (rawName && !contactInfo.name) contactInfo.name = String(rawName).trim();
  if (contactInfo.email) contactInfo.email = String(contactInfo.email).toLowerCase().trim();
  if (contactInfo.phone) contactInfo.phone = String(contactInfo.phone).replace(/\s+/g, '').trim();
  return contactInfo;
}

/** `meta.contact` for one user message: regex on text, then merged form (form wins for filled fields). */
export function buildUserMessageContactMeta(trimmedMessage, mergedFormContact) {
  return mergeContact(extractContactFromMessage(trimmedMessage), contactPatchFromMergedForm(mergedFormContact));
}

export function hasIdentityContact(contactInfo) {
  if (!contactInfo || typeof contactInfo !== 'object') return false;
  const name = contactInfo.name || contactInfo.full_name || contactInfo.fullName;
  return Boolean(
    (name && String(name).trim()) ||
      (contactInfo.email && String(contactInfo.email).trim()) ||
      (contactInfo.phone && String(contactInfo.phone).trim()),
  );
}

/**
 * Build accumulated contact from stored message meta (O(1) per message — no
 * re-extraction from raw text). Falls back to regex only when meta is absent.
 */
export const accumulateContactInfo = async (conversationId, latestContact = {}) => {
  const messages = await ChatMessage.find({ conversation_id: conversationId })
    .sort({ createdAt: 1 })
    .select('meta');

  let accumulated = { email: null, phone: null, name: null, address: null };

  for (const msg of messages) {
    const stored = msg.meta?.contact || {};
    accumulated = mergeContact(accumulated, stored);
  }

  return mergeContact(accumulated, latestContact);
};
