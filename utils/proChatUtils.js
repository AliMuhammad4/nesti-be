import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE_VALUES, USER_ROLE } from '../constants/roles.js';

export const PROCHAT_ATTACHMENT_LIMITS = {
  images: 10,
  documents: 10,
};

export function normalizeId(value) {
  const s = String(value || '').trim();
  return s || null;
}

export function toObjectId(value) {
  const s = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

export function participantsKey(a, b) {
  const ids = [String(a || '').trim(), String(b || '').trim()].filter(Boolean).sort();
  return ids.length === 2 ? `${ids[0]}:${ids[1]}` : '';
}

export function isProfessionalRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === String(USER_ROLE.ADMIN || '').toLowerCase()) return true;
  return PROFESSIONAL_TYPE_VALUES.includes(r);
}

export function userSummary(u) {
  if (!u) return null;
  return {
    id: String(u._id || u.id || ''),
    first_name: u.first_name || '',
    last_name: u.last_name || '',
    full_name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim(),
    email: u.email || '',
    role: u.role || null,
    profile_image: u.profile_image || null,
  };
}

export function displayName(user, fallback = 'A professional') {
  return (
    [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
    String(user?.email || '').trim() ||
    fallback
  );
}

export function threadSummary(t) {
  if (!t) return null;
  const participantsKey = String(t.participants_key || '');
  const isLeadThread = participantsKey.startsWith('lead:');
  return {
    id: String(t._id || t.id || ''),
    thread_type: t.thread_type || 'dm',
    title: t.title || null,
    is_lead_thread: isLeadThread,
    lead_id: isLeadThread ? (participantsKey.split(':')[1] || null) : null,
    created_by: t.created_by ? String(t.created_by) : null,
    participants: Array.isArray(t.participants) ? t.participants.map(String) : [],
    left_participants: Array.isArray(t.left_participants) ? t.left_participants.map(String) : [],
    member_count: Array.isArray(t.participants) ? t.participants.length : 0,
    last_message_at: t.last_message_at || null,
    last_message_text: t.last_message_text || null,
    last_message_sender_id: t.last_message_sender_id ? String(t.last_message_sender_id) : null,
    created_at: t.createdAt || null,
    updated_at: t.updatedAt || null,
  };
}

export function rejoinRequestStatusForUser(thread, userId) {
  const me = String(userId || '').trim();
  if (!me) return null;
  const rows = Array.isArray(thread?.rejoin_requests) ? thread.rejoin_requests : [];
  const found = rows.find((r) => String(r?.user_id || '') === me);
  return found?.status || null;
}

export function normalizeAttachments(attsRaw) {
  return (Array.isArray(attsRaw) ? attsRaw : [])
    .map((a) => {
      const url = String(a?.secure_url || a?.url || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) return null;
      return {
        url,
        secure_url: url,
        public_id: a?.public_id ? String(a.public_id).slice(0, 256) : null,
        resource_type: a?.resource_type ? String(a.resource_type).slice(0, 32) : null,
        format: a?.format ? String(a.format).slice(0, 32) : null,
        bytes: a?.bytes != null ? Number(a.bytes) : null,
        original_filename: a?.original_filename ? String(a.original_filename).slice(0, 256) : null,
        filename: a?.filename ? String(a.filename).slice(0, 256) : null,
        mime_type: a?.mime_type ? String(a.mime_type).slice(0, 128) : null,
      };
    })
    .filter(Boolean);
}

export function isImageAttachmentPayload(a) {
  const mime = String(a?.mime_type || '').trim().toLowerCase();
  if (mime) return mime.startsWith('image/');
  const rt = String(a?.resource_type || '').trim().toLowerCase();
  if (rt === 'image') return true;
  const url = String(a?.secure_url || a?.url || '').trim().toLowerCase();
  return url.includes('/image/upload/');
}

export function countProChatAttachmentTypes(attachments) {
  return (Array.isArray(attachments) ? attachments : []).reduce(
    (acc, att) => {
      if (isImageAttachmentPayload(att)) acc.images += 1;
      else acc.documents += 1;
      return acc;
    },
    { images: 0, documents: 0 }
  );
}

export function validateProChatAttachmentLimits(attachments) {
  const counts = countProChatAttachmentTypes(attachments);
  if (counts.images > PROCHAT_ATTACHMENT_LIMITS.images) {
    return {
      ok: false,
      code: 'too_many_images',
      message: `Too many image attachments (max ${PROCHAT_ATTACHMENT_LIMITS.images})`,
    };
  }
  if (counts.documents > PROCHAT_ATTACHMENT_LIMITS.documents) {
    return {
      ok: false,
      code: 'too_many_documents',
      message: `Too many PDF/document attachments (max ${PROCHAT_ATTACHMENT_LIMITS.documents})`,
    };
  }
  return { ok: true, counts };
}

export function messageSummary(message, sender) {
  if (!message) return null;
  return {
    id: String(message._id || message.id || ''),
    thread_id: String(message.thread_id),
    sender_user_id: String(message.sender_user_id),
    client_id: message.client_id || null,
    body: message.body,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    created_at: message.createdAt,
    sender: userSummary(sender),
  };
}
