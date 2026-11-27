import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const LOW = 1024 * MB;

function freeBytes(target) {
  try {
    const stats = fs.statfsSync(target);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function clearLogs(dir, match, now) {
  let freed = 0;
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of names) {
    if (!entry.isFile() || !match(entry.name)) continue;
    const file = path.join(dir, entry.name);
    let stats;
    try {
      stats = fs.statSync(file);
    } catch {
      continue;
    }
    if (stats.size <= 5 * MB && now - stats.mtimeMs <= DAY) continue;
    try {
      fs.rmSync(file, { force: true });
      freed += stats.size;
    } catch {
      // The file is in use. Leave it.
    }
  }
  return freed;
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Already gone.
  }
}

/** Old Nesti logs, and the npm download cache only when under 1 GB is free. */
export function freeDisk({ now = Date.now() } = {}) {
  const before = freeBytes(root);
  let freed = clearLogs(os.tmpdir(), (name) => /^nesti-.*\.log$/i.test(name), now);
  freed += clearLogs(path.join(root, 'logs'), (name) => name.endsWith('.log'), now);
  if (before != null && before < LOW) {
    const home = os.homedir();
    removeDir(path.join(home, '.npm', '_logs'));
    removeDir(path.join(home, '.npm', '_cacache'));
    const after = freeBytes(root);
    if (after != null && after > before) freed = after - before;
  }
  return { freed, free: freeBytes(root) ?? before };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cleaned = freeDisk();
  const mb = (bytes) => (Number.isFinite(bytes) ? `${Math.round(bytes / MB)} MB` : 'unknown');
  console.log(`Freed ${mb(cleaned.freed)}. ${mb(cleaned.free)} still free.`);
}
