import http from 'http';
import app from './app.js';
import connectDB from './config/db.js';
import logger from './utils/logger.js';
import { initWorkspaceSocket } from './services/realtime/workspaceSocket.js';
import { scheduleMonthlyRewardJob } from './jobs/rewardMonthlyJob.js';
import { scheduleNurtureFollowupJob } from './jobs/nurtureFollowupJob.js';
import { startCallMinutesReconciliation } from './services/proChat/callMinutesService.js';
import { ensureTranscriptionWorkerRunning } from './services/proChat/callTranscriptionDispatchService.js';
import './models/index.js'; // Ensure all models are registered

const PORT = process.env.PORT || 5000;

const httpServer = http.createServer(app);

async function startServer() {
  await connectDB();
  await initWorkspaceSocket(httpServer);
  httpServer.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} (HTTP + WebSocket)`);
    scheduleMonthlyRewardJob();
    scheduleNurtureFollowupJob();
    startCallMinutesReconciliation();
    void ensureTranscriptionWorkerRunning().catch((error) => {
      logger.warn('Transcription worker did not start with the API server', {
        message: error?.message,
      });
    });
  });
}

startServer().catch((error) => {
  logger.error('Server startup failed', { message: error?.message });
  process.exit(1);
});
