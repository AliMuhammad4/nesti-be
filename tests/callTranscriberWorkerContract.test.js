import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('transcription worker is explicit, current, and never persists audio', async () => {
  const [workerSource, agentSource, participantSource, packageJson] = await Promise.all([
    readFile(new URL('../workers/callTranscriberWorker.js', import.meta.url), 'utf8'),
    readFile(new URL('../workers/callTranscriberAgent.js', import.meta.url), 'utf8'),
    readFile(new URL('../workers/lib/participantTranscription.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  assert.match(workerSource, /agentName:\s*TRANSCRIPTION_AGENT_NAME/);
  assert.match(workerSource, /callTranscriberAgent\.js/);
  assert.match(workerSource, /TRANSCRIPTION_AGENT_DISPLAY_NAME/);
  assert.match(workerSource, /job\.accept\(/);
  assert.match(participantSource, /new AudioStream/);
  assert.match(participantSource, /INTERIM_TRANSCRIPT/);
  assert.match(participantSource, /FINAL_TRANSCRIPT/);
  assert.match(participantSource, /persistFinalTranscriptSegment/);
  assert.doesNotMatch(participantSource, /publishTranscription/);
  assert.match(participantSource, /authorizeParticipantTranscriptionSession/);
  assert.match(agentSource, /consentRetry|setInterval/);
  assert.match(agentSource, /activeTasks\.set\(identity,\s*null\)/);
  assert.match(agentSource, /completeTranscriptionAfterDrain/);
  assert.match(agentSource, /transcription_dispatch_generation/);
  assert.match(workerSource, /loadThreshold/);
  assert.doesNotMatch(workerSource, /Number\.POSITIVE_INFINITY/);
  assert.doesNotMatch(agentSource, /markTranscriptionFailed\(\s*metadata\.call_id,\s*'participant_transcription_failed'/);
  // LiveKit invokes entrypoints as (jobContext, participant).
  assert.match(
    agentSource,
    /addParticipantEntrypoint\(\s*async\s*\(\s*\w+\s*,\s*\w+\s*\)/,
  );
  assert.doesNotMatch(
    agentSource,
    /writeFile|appendFile|createWriteStream|initRecording|publishTrack|AudioSource/,
  );
  assert.equal(packageJson.dependencies['@livekit/agents'], '^1.5.2');
  assert.equal(packageJson.dependencies['@livekit/agents-plugin-openai'], '^1.5.2');
  assert.equal(
    packageJson.scripts['worker:transcription'],
    'node scripts/startTranscriptionWorker.mjs',
  );
});
