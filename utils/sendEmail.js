import nodemailer from 'nodemailer';
import logger from './logger.js';

const sendEmail = async (options) => {
  try {
    // Create a transporter object using standard SMTP transport
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports (like 587)
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Setup email data
    const mailOptions = {
      from: `"Nesti AI" <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.htmlMessage || `<p>${options.message}</p>`,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Message sent: ${info.messageId}`);
    
    return { success: true };
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
    return { success: false, error };
  }
};

export default sendEmail;