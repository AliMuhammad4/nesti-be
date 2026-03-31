import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import * as models from '../models/index.js';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    for (const modelName of Object.keys(models)) {
      await models[modelName].createCollection();
    }
    logger.info('All database collections have been initialized.');
    
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
