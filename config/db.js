import dns from 'node:dns';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import * as models from '../models/index.js';

const DB_OPTIONS = {
  maxPoolSize: 100,
  minPoolSize: 5,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  retryWrites: true,
};

const DNS_FAILURE = /querySrv|queryTxt|ENOTFOUND|ETIMEOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ESERVFAIL|EREFUSED/i;

async function connectWithRetry() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await mongoose.connect(process.env.MONGO_URI, DB_OPTIONS);
    } catch (error) {
      const detail = `${error?.code || ''} ${error?.message || ''}`;
      if (attempt >= 5 || !DNS_FAILURE.test(detail)) throw error;
      if (attempt === 1) {
        try {
          dns.setServers(['1.1.1.1', '8.8.8.8', ...dns.getServers()]);
        } catch {
        }
      }
      logger.warn(`MongoDB connect failed, retrying (${attempt} of 4): ${error?.message || 'unknown error'}`);
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}

const connectDB = async () => {
  try {
    const conn = await connectWithRetry();
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    await Promise.all(
      Object.keys(models).map(async (modelName) => {
        try {
          await models[modelName].createCollection();
        } catch (err) {
          // Collection may already exist; this should not fail startup.
          if (err?.codeName !== 'NamespaceExists') throw err;
        }
      })
    );
    logger.info('All database collections have been initialized.');
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
