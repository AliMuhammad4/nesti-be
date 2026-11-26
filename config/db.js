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

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, DB_OPTIONS);
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
