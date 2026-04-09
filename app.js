import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dns from 'node:dns';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import dotenv from 'dotenv';
import morgan from 'morgan';
import logger from './utils/logger.js';
import authRoutes from './routes/authRoutes.js';
import embedRoutes from './routes/embedRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
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
    const port = Number(process.env.EMAIL_PORT) || 587;
    const requireTls = process.env.EMAIL_REQUIRE_TLS === 'true';
    const connectTimeoutMs = Number(process.env.SMTP_HEALTH_CONNECTION_TIMEOUT_MS) || 8000;
    const greetingTimeoutMs = Number(process.env.SMTP_HEALTH_GREETING_TIMEOUT_MS) || 8000;
    const socketTimeoutMs = Number(process.env.SMTP_HEALTH_SOCKET_TIMEOUT_MS) || 10000;

    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        success: false,
        message: 'Missing SMTP config: EMAIL_HOST, EMAIL_USER, or EMAIL_PASS',
      });
    }
    const originalHost = process.env.EMAIL_HOST;
    const resolvedIpv4Hosts = await dns.promises.resolve4(originalHost);
    if (!resolvedIpv4Hosts?.length) {
      return res.status(500).json({
        success: false,
        message: `Could not resolve IPv4 address for ${originalHost}`,
      });
    }
    const smtpHost = resolvedIpv4Hosts[0];

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure: port === 465,
      requireTLS: requireTls,
      family: 4,
      tls: { servername: originalHost },
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      connectionTimeout: connectTimeoutMs,
      greetingTimeout: greetingTimeoutMs,
      socketTimeout: socketTimeoutMs,
    });

    await transporter.verify();
    return res.json({
      success: true,
      message: 'SMTP connection verified successfully',
      host: originalHost,
      resolvedHost: smtpHost,
      port,
      secure: port === 465,
      requireTLS: requireTls,
      timeouts: {
        connectionTimeout: connectTimeoutMs,
        greetingTimeout: greetingTimeoutMs,
        socketTimeout: socketTimeoutMs,
      },
    });
  } catch (error) {
    logger.error(`SMTP health check failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'SMTP verification failed',
      error: error.message,
    });
  }
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/embed', embedRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/leads', leadRoutes);
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
