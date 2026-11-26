import dns from 'node:dns';
import mongoose from 'mongoose';
import logger from '../../utils/logger.js';
import { text } from './text.js';

const PUBLIC_DNS = ['1.1.1.1', '8.8.8.8'];
const DNS_FAILURE = /querySrv|queryTxt|ENOTFOUND|ETIMEOUT|ECONNREFUSED|EAI_AGAIN|ESERVFAIL/i;

let mongoConnecting = null;
let publicDns = false;
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

export function isDnsFailure(error) {
  return DNS_FAILURE.test(`${error?.code || ''} ${error?.syscall || ''} ${error?.message || ''}`);
}

export function usePublicDns() {
  if (publicDns) return false;
  publicDns = true;
  try {
    const current = dns.getServers().filter((server) => !PUBLIC_DNS.includes(server));
    dns.setServers([...PUBLIC_DNS, ...current]);
    logger.warn(`Ravi is using public DNS (${PUBLIC_DNS.join(', ')}) for this worker`);
    installDnsLookupFallback();
    return true;
  } catch (error) {
    logger.warn(`Ravi could not switch to public DNS (${error?.message || 'unknown error'})`);
    return false;
  }
}

let lookupFallback = false;

export function installDnsLookupFallback() {
  if (lookupFallback) return false;
  lookupFallback = true;
  const original = dns.lookup.bind(dns);
  const resolver = new dns.Resolver();
  resolver.setServers(PUBLIC_DNS);
  dns.lookup = (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }
    original(hostname, options, (error, address, family) => {
      if (!error || !callback || !isDnsFailure(error)) {
        callback?.(error, address, family);
        return;
      }
      usePublicDns();
      const all = options && typeof options === 'object' && options.all;
      resolver.resolve4(hostname, (error4, ipv4) => {
        if (!error4 && ipv4?.length) {
          callback(null, all ? ipv4.map((ip) => ({ address: ip, family: 4 })) : ipv4[0], all ? undefined : 4);
          return;
        }
        resolver.resolve6(hostname, (error6, ipv6) => {
          if (!error6 && ipv6?.length) {
            callback(null, all ? ipv6.map((ip) => ({ address: ip, family: 6 })) : ipv6[0], all ? undefined : 6);
            return;
          }
          callback(error, address, family);
        });
      });
    });
  };
  return true;
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
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
      return;
    } catch (error) {
      lastError = error;
      const detail = `${error?.code || ''} ${error?.message || ''}`;
      if (attempt === 3 || !/ETIMEOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timed out|network/i.test(detail)) break;
      logger.warn(`Ravi database connect failed, retrying (${attempt} of 3)`, { error: error?.message });
      if (isDnsFailure(error) && usePublicDns()) continue;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}
