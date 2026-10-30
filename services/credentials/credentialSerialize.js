import User from '../../models/User.js';
import { CREDENTIAL_DOC_LABELS } from '../../constants/credentialDocuments.js';
import {
  describeCredentialRequirements,
  getRequiredCredentialDocs,
} from './credentialRequirements.js';
import { buildCredentialGate } from './credentialGate.js';
import { serializeEvents } from './credentialEvents.js';

async function resolveActorMap(profile) {
  const ids = new Set();
  if (profile?.credential_reviewed_by) ids.add(String(profile.credential_reviewed_by));
  for (const ev of profile?.credential_events || []) {
    if (ev.actor_user_id) ids.add(String(ev.actor_user_id));
  }
  if (!ids.size) return {};
  const users = await User.find({ _id: { $in: [...ids] } })
    .select('first_name last_name email')
    .lean();
  return Object.fromEntries(users.map((u) => [String(u._id), u]));
}

function sanitizeEventMeta(meta, audience) {
  if (!meta || typeof meta !== 'object') return meta || null;
  if (audience === 'admin') return meta;
  const next = { ...meta };
  delete next.email_results;
  if (next.email_meta && typeof next.email_meta === 'object') {
    next.email_meta = { email_status: next.email_meta.email_status || null };
  }
  return next;
}

function serializeDocuments(docs, audience) {
  return (docs || []).map((doc) => {
    const base = {
      id: String(doc._id),
      type: doc.type,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      uploaded_at: doc.uploaded_at,
      status: doc.status || 'uploaded',
    };
    if (audience === 'admin') {
      return {
        ...base,
        file_url: doc.file_url,
        file_key: doc.file_key || '',
      };
    }
    return base;
  });
}

export function serializeCredentialState(profile, role, { actorMap = {}, audience = 'professional' } = {}) {
  const isAdmin = audience === 'admin';
  const status = String(profile?.credential_status || 'not_started');
  const country = profile?.country || null;
  const checklist = getRequiredCredentialDocs({
    role: profile?.professional_type || role,
    country,
  });
  const uploadedTypes = new Set(
    (profile?.credential_documents || []).map((doc) => String(doc.type || '')),
  );
  const reviewerId = profile?.credential_reviewed_by
    ? String(profile.credential_reviewed_by)
    : null;
  const reviewerUser = reviewerId ? actorMap[reviewerId] : null;

  const checklistItems = checklist.map((item) => ({
    ...item,
    uploaded: uploadedTypes.has(item.type),
  }));

  if (isAdmin) {
    for (const doc of profile?.credential_documents || []) {
      const type = String(doc.type || '');
      if (!type || checklistItems.some((item) => item.type === type)) continue;
      checklistItems.push({
        type,
        label: CREDENTIAL_DOC_LABELS[type] || type.replace(/_/g, ' '),
        required: false,
        uploaded: true,
        extra: true,
      });
    }
  }

  const payload = {
    credential_status: status,
    country,
    jurisdiction: profile?.jurisdiction || '',
    nmls_id: profile?.nmls_id || '',
    license_number: profile?.license_number || '',
    company_name: profile?.company_name || '',
    credential_submitted_at: profile?.credential_submitted_at || null,
    credential_reviewed_at: profile?.credential_reviewed_at || null,
    credential_reject_reason: profile?.credential_reject_reason || '',
    reviewed_by: reviewerUser
      ? {
          id: reviewerId,
          first_name: reviewerUser.first_name,
          last_name: reviewerUser.last_name,
          ...(isAdmin ? { email: reviewerUser.email } : {}),
          name:
            [reviewerUser.first_name, reviewerUser.last_name].filter(Boolean).join(' ')
            || (isAdmin ? reviewerUser.email : 'Admin'),
        }
      : reviewerId
        ? { id: reviewerId, name: null }
        : null,
    events: serializeEvents(profile?.credential_events, actorMap).map((ev) => ({
      ...ev,
      meta: sanitizeEventMeta(ev.meta, audience),
      actor: ev.actor
        ? {
            id: ev.actor.id,
            name: ev.actor.name,
            ...(isAdmin
              ? {
                  first_name: ev.actor.first_name,
                  last_name: ev.actor.last_name,
                  email: ev.actor.email,
                }
              : {}),
          }
        : ev.actor,
    })),
    requirements_summary: describeCredentialRequirements({
      role: profile?.professional_type || role,
      country,
      audience,
    }),
    checklist: checklistItems,
    documents: serializeDocuments(profile?.credential_documents, audience),
  };

  if (!isAdmin) {
    payload.credential_gate = buildCredentialGate(profile, role);
  }

  return payload;
}

export async function serializeCredentialStateAsync(profile, role, options = {}) {
  const actorMap = await resolveActorMap(profile);
  return serializeCredentialState(profile, role, { ...options, actorMap });
}
