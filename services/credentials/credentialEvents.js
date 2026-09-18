export const MAX_CREDENTIAL_EVENTS = 100;

export function pushCredentialEvent(profile, event) {
  if (!profile.credential_events) profile.credential_events = [];
  profile.credential_events.push({
    at: event.at || new Date(),
    type: event.type,
    actor_user_id: event.actor_user_id || null,
    actor_role: event.actor_role || '',
    reason: event.reason || '',
    meta: event.meta || null,
  });
  if (profile.credential_events.length > MAX_CREDENTIAL_EVENTS) {
    profile.credential_events = profile.credential_events.slice(-MAX_CREDENTIAL_EVENTS);
  }
}

/** Mongo $push payload for atomic approve/reject. */
export function credentialEventPushOp(event) {
  return {
    $each: [
      {
        at: event.at || new Date(),
        type: event.type,
        actor_user_id: event.actor_user_id || null,
        actor_role: event.actor_role || '',
        reason: event.reason || '',
        meta: event.meta || null,
      },
    ],
    $slice: -MAX_CREDENTIAL_EVENTS,
  };
}

/**
 * Id of the most recent event of a type. Meta must be attached by id — the
 * positional `$` operator with a `type` match always targets the oldest match,
 * which lands on a previous cycle once a professional resubmits.
 */
export function latestCredentialEventId(profile, type) {
  const events = profile?.credential_events || [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === type) return events[i]?._id || null;
  }
  return null;
}

export function serializeEvents(events = [], actorMap = {}) {
  return [...(events || [])]
    .slice()
    .reverse()
    .slice(0, 40)
    .map((ev) => {
      const actorId = ev.actor_user_id ? String(ev.actor_user_id) : null;
      const actor = actorId ? actorMap[actorId] : null;
      return {
        id: String(ev._id || ''),
        at: ev.at || null,
        type: ev.type,
        actor_role: ev.actor_role || '',
        reason: ev.reason || '',
        meta: ev.meta || null,
        actor: actor
          ? {
              id: actorId,
              first_name: actor.first_name,
              last_name: actor.last_name,
              email: actor.email,
              name: [actor.first_name, actor.last_name].filter(Boolean).join(' ') || actor.email,
            }
          : actorId
            ? { id: actorId, name: null, email: null }
            : null,
      };
    });
}
