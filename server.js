import app from './app.js';
import connectDB from './config/db.js';
import logger from './utils/logger.js';
import './models/index.js'; // Ensure all models are registered

// Connect to database
connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
