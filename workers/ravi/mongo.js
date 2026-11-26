import mongoose from 'mongoose';
import { text } from './text.js';

let mongoConnecting = null;
let prewarmKnown = false;
let prewarmOk = false;

export const DB_WAIT_MS = 4000;
export const FAST_DB_WAIT_MS = 500;

export function markMongoPrewarm(ok) {
  prewarmKnown = true;
  prewarmOk = Boolean(ok);
}

export function mongoPrewarmFailed() {
  return prewarmKnown && !prewarmOk;
}

export function dbWaitMs() {
  return mongoPrewarmFailed() ? FAST_DB_WAIT_MS : DB_WAIT_MS;
}

export function mongoReady() {
  return mongoose.connection.readyState === 1;
}

export async function connectMongo() {
  if (mongoReady()) return;
  if (!mongoConnecting) {
    mongoConnecting = openMongo().finally(() => {
      mongoConnecting = null;
    });
  }
  await mongoConnecting;
}

export async function waitForMongo(ms) {
  if (mongoReady()) return true;
  let timer;
  const attempt = connectMongo().then(() => true, () => false);
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([attempt, limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function openMongo() {
  const uri = text(process.env.MONGO_URI);
  if (!uri) throw new Error('MONGO_URI is required by the Ravi worker.');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
}
