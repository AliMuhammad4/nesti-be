import { Resend } from 'resend';
import logger from './logger.js';

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

function getFromAddress() {
  const email = process.env.RESEND_FROM_EMAIL;
  const name = process.env.RESEND_FROM_NAME;
  if (!email) return '';
  return name ? `${name} <${email}>` : email;
}

function asInt(value, fallback, { min = 1, max = 120000 } = {}) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Email send timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function isTransientEmailError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('temporar') ||
    message.includes('service unavailable') ||
    /\b5\d\d\b/.test(message)
  );
}

const sendEmail = async (options) => {
  try {
    if (!isResendConfigured()) {
      throw new Error('Missing Resend config: RESEND_API_KEY or RESEND_FROM_EMAIL');
    }

    if (options.templateAlias || options.templateId) {
      logger.warn('Email templates are not supported with Resend; sending HTML body instead.');
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const timeoutMs = asInt(process.env.RESEND_SEND_TIMEOUT_MS, 20000, { min: 5000, max: 120000 });
    const maxAttempts = asInt(process.env.RESEND_SEND_MAX_ATTEMPTS, 3, { min: 1, max: 5 });

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { data, error } = await withTimeout(
          resend.emails.send({
            from: getFromAddress(),
            to: [options.email],
            subject: options.subject,
            text: options.message,
            html: options.htmlMessage || `<p>${options.message}</p>`,
          }),
          timeoutMs,
        );

        if (error) {
          throw new Error(error.message || 'Resend send failed');
        }

        logger.info(`Message sent via Resend: ${data?.id || 'unknown'}`);
        return { success: true, id: data?.id };
      } catch (attemptError) {
        lastError = attemptError;
        if (attempt >= maxAttempts || !isTransientEmailError(attemptError)) {
          throw attemptError;
        }
        const backoffMs = 500 * 2 ** (attempt - 1);
        logger.warn('Transient email send failure; retrying', {
          attempt,
          maxAttempts,
          backoffMs,
          error: attemptError?.message,
        });
        await sleep(backoffMs);
      }
    }

    throw lastError || new Error('Resend send failed');
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
    return { success: false, error };
  }
};

export default sendEmail;
