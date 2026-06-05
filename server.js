import http from 'http';
import app from './app.js';
import connectDB from './config/db.js';
import logger from './utils/logger.js';
import { initWorkspaceSocket } from './services/realtime/workspaceSocket.js';
import { scheduleMonthlyRewardJob } from './jobs/rewardMonthlyJob.js';
import { scheduleNurtureFollowupJob } from './jobs/nurtureFollowupJob.js';
import './models/index.js'; // Ensure all models are registered

// Connect to database
connectDB();

const PORT = process.env.PORT || 5000;

const httpServer = http.createServer(app);
initWorkspaceSocket(httpServer);

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} (HTTP + WebSocket)`);
  scheduleMonthlyRewardJob();
  scheduleNurtureFollowupJob();
});
