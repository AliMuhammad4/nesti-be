import { RoomEvent, TrackSource } from '@livekit/rtc-node';

export function microphonePublication(participant) {
  return [...participant.trackPublications.values()].find(
    (publication) =>
      publication.source === TrackSource.SOURCE_MICROPHONE && publication.track,
  );
}

export async function waitForMicrophone(ctx, participant, logger, timeoutMs = 12_000) {
  const existing = microphonePublication(participant);
  if (existing) return existing;

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      logger.warn(
        {
          participant: participant.identity,
          publications: [...participant.trackPublications.values()].map((publication) => ({
            sid: publication.sid,
            source: publication.source,
            has_track: Boolean(publication.track),
            subscribed: publication.subscribed,
          })),
        },
        'Timed out waiting for microphone track',
      );
      finish(microphonePublication(participant));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ctx.room.off(RoomEvent.TrackSubscribed, onSubscribed);
      ctx.room.off(RoomEvent.TrackPublished, onPublished);
      ctx.room.off(RoomEvent.ParticipantDisconnected, onDisconnected);
    };
    const finish = (publication) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(publication || null);
    };
    const onSubscribed = (_track, publication, owner) => {
      if (
        owner.identity === participant.identity &&
        publication.source === TrackSource.SOURCE_MICROPHONE
      ) {
        finish(publication);
      }
    };
    const onPublished = (publication, owner) => {
      if (
        owner?.identity === participant.identity &&
        publication.source === TrackSource.SOURCE_MICROPHONE
      ) {
        try {
          publication.setSubscribed?.(true);
        } catch {
          // Best effort.
        }
        if (publication.track) finish(publication);
      }
    };
    const onDisconnected = (owner) => {
      if (owner.identity === participant.identity) finish(null);
    };

    ctx.room.on(RoomEvent.TrackSubscribed, onSubscribed);
    ctx.room.on(RoomEvent.TrackPublished, onPublished);
    ctx.room.on(RoomEvent.ParticipantDisconnected, onDisconnected);

    for (const publication of participant.trackPublications.values()) {
      if (publication.source === TrackSource.SOURCE_MICROPHONE) {
        try {
          publication.setSubscribed?.(true);
        } catch {
          // Best effort.
        }
      }
    }
    const subscribedWhileRegistering = microphonePublication(participant);
    if (subscribedWhileRegistering) finish(subscribedWhileRegistering);
  });
}
