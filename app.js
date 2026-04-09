import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import postmark from 'postmark';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import dotenv from 'dotenv';
import morgan from 'morgan';
import logger from './utils/logger.js';
import authRoutes from './routes/authRoutes.js';
import embedRoutes from './routes/embedRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import professionalRoutes from './routes/professionalRoutes.js';
import calendarRoutes from './routes/calendarRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import calendlyWebhookRoutes from './routes/calendlyWebhookRoutes.js';
import propertyMatchScoringRoutes from './routes/agent/propertyMatchScoringRoutes.js';

// Load env
dotenv.config();

const app = express();

// HTTP Request Logging Middleware using Morgan and Winston
const morganFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// Middleware
app.use(cors());

// Webhooks often need raw bodies, so they are routed before express.json()
app.use('/api/billing/stripe/webhook', webhookRoutes); // Just map the stripe webhook path to here if needed or separate it. We will map all webhooks to /api/webhooks in app.js, except stripe if it needs special handling. Let's handle stripe inside webhookRoutes.

app.use(
  '/api/webhooks/calendly',
  express.raw({ type: 'application/json' }),
  calendlyWebhookRoutes
);

// We need express.json() for all other routes
app.use(express.json());

// Static HTML pages for testing
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/mortgage-broker', (req, res) => {
  res.sendFile(path.join(__dirname, 'mortgage-broker.html'));
});
app.get('/lawyer', (req, res) => {
  res.sendFile(path.join(__dirname, 'lawyer.html'));
});

app.get('/api/health/smtp', async (req, res) => {
  try {
    if (!process.env.POSTMARK_SERVER_TOKEN || !process.env.POSTMARK_FROM_EMAIL) {
      return res.status(500).json({
        success: false,
        message: 'Missing Postmark config: POSTMARK_SERVER_TOKEN or POSTMARK_FROM_EMAIL',
      });
    }

    const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
    const server = await client.getServer();

    return res.json({
      success: true,
      message: 'Postmark connection verified successfully',
      serverName: server?.Name,
      postmarkFromEmail: process.env.POSTMARK_FROM_EMAIL,
    });
  } catch (error) {
    logger.error(`Postmark health check failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Postmark verification failed',
      error: error.message,
    });
  }
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/embed', embedRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/professionals', professionalRoutes);
app.use('/api/property-match-scoring', propertyMatchScoringRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/webhooks', webhookRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  logger.error(err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server Error' });
});

export default app;
