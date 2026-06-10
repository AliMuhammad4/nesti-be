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

const sendEmail = async (options) => {
  try {
    if (!isResendConfigured()) {
      throw new Error('Missing Resend config: RESEND_API_KEY or RESEND_FROM_EMAIL');
    }

    if (options.templateAlias || options.templateId) {
      logger.warn('Email templates are not supported with Resend; sending HTML body instead.');
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to: [options.email],
      subject: options.subject,
      text: options.message,
      html: options.htmlMessage || `<p>${options.message}</p>`,
    });

    if (error) {
      throw new Error(error.message || 'Resend send failed');
    }

    logger.info(`Message sent via Resend: ${data?.id || 'unknown'}`);

    return { success: true, id: data?.id };
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
    return { success: false, error };
  }
};

export default sendEmail;
