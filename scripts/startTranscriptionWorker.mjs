import 'dotenv/config';
import {
  resolveTranscriptionWorkerPort,
  spawnTranscriptionWorkerProcess,
} from '../services/proChat/transcriptionWorkerRuntime.js';

const port = resolveTranscriptionWorkerPort();
console.log(`Starting transcription worker on :${port}`);

const child = spawnTranscriptionWorkerProcess({
  port,
  stdioMode: 'inherit',
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
