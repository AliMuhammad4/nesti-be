# Voice agent runbook

## Flags
- `VOICE_AGENT_ENABLED`
- `TWILIO_VOICE_ENABLED`
- `VOICE_RECORDING_R2_ENABLED`
- `VOICE_AGENT_AUTOCOMMIT` must stay `false` unless a reviewed allowlist is enabled.

Required Twilio settings: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `TWILIO_WEBHOOK_BASE_URL`. Recordings reuse the existing `R2_BUCKET_PUBLIC` and existing R2 credentials.

## Replay
Twilio status, recording, and transcription webhooks are signature-checked. Recording rows are unique on `RecordingSid`. Replaying a completed recording webhook does not create a second object.

## Recovery
Failed recording jobs retry with backoff up to 5 attempts, then move to `dead`. Fix credentials or the source URL, then set `ingest_status` back to `pending` and `next_attempt_at` to now.

## Retention and legal hold
Recordings expire with `delete_at` unless `legal_hold` is true. Do not purge a held recording. Playback URLs are signed for 10 minutes and are never public R2 links.
