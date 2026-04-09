import nodemailer from 'nodemailer';
import dns from 'node:dns';
import logger from './logger.js';

const sendEmail = async (options) => {
  try {
    const port = Number(process.env.EMAIL_PORT) || 587;
    const requireTls = process.env.EMAIL_REQUIRE_TLS === 'true';
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('Missing SMTP config: EMAIL_HOST, EMAIL_USER, or EMAIL_PASS');
    }

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port,
      secure: port === 465,
      requireTLS: requireTls,
      family: 4,
      lookup: (hostname, options, callback) => dns.lookup(hostname, { family: 4 }, callback),
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      connectionTimeout: 60_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    });

    const mailOptions = {
      from: `"Nesti" <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.htmlMessage || `<p>${options.message}</p>`,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Message sent: ${info.messageId}`);

    return { success: true };
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
    return { success: false, error };
  }
};

export default sendEmail;