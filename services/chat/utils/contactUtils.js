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
