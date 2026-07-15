import ProfessionalCall from '../../models/ProfessionalCall.js';

function text(value) {
  return String(value || '').trim();
}

function normalizedSnapshot(values) {
  return [...new Set((values || []).map(text).filter(Boolean))].sort();
}

function snapshotsMatch(left, right) {
  const first = normalizedSnapshot(left);
  const second = normalizedSnapshot(right);
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

export function consentingParticipantIds(call) {
  const participantIds = [...new Set(
    (call.participant_ids || []).map((participantId) => text(participantId)).filter(Boolean),
  )];
  return [
    ...new Set(
      (call.participant_states || [])
        .filter((participant) => participant.transcription_consent === true)
        .map((participant) => text(participant.user_id))
        .filter((participantId) => participantIds.includes(participantId)),
    ),
  ];
}

export async function authorizeParticipantTranscriptionSession({
  callId,
  roomName,
  participantIdentity,
  expectedParticipantIds,
}) {
  const normalizedCallId = text(callId);
  const normalizedRoomName = text(roomName);
  const userId = text(participantIdentity);
  if (!normalizedCallId || !normalizedRoomName || !userId) return null;

  const call = await ProfessionalCall.findOne({
    _id: normalizedCallId,
    room_name: normalizedRoomName,
    status: 'active',
    started_at: { $ne: null },
    participant_ids: userId,
    participant_states: {
      $elemMatch: {
        user_id: userId,
        transcription_consent: true,
        $or: [
          { status: { $in: ['invited', 'joined'] } },
          { joined_at: { $ne: null } },
        ],
      },
    },
  })
    .select('started_at participant_ids transcription_policy_version')
    .lean();
  if (!call || !snapshotsMatch(call.participant_ids, expectedParticipantIds)) return null;

  const startedAtMs = new Date(call.started_at).getTime();
  if (!Number.isFinite(startedAtMs)) return null;
  return {
    call_id: text(call._id || normalizedCallId),
    participant_identity: userId,
    started_at_ms: startedAtMs,
    transcription_policy_version: text(call.transcription_policy_version),
  };
}

export function assertImmutableParticipantSnapshot(actualParticipantIds, expectedParticipantIds) {
  return snapshotsMatch(actualParticipantIds, expectedParticipantIds);
}
