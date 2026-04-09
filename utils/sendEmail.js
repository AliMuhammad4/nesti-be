import postmark from 'postmark';
import logger from './logger.js';

const sendEmail = async (options) => {
  try {
    if (!process.env.POSTMARK_SERVER_TOKEN || !process.env.POSTMARK_FROM_EMAIL) {
      throw new Error('Missing Postmark config: POSTMARK_SERVER_TOKEN or POSTMARK_FROM_EMAIL');
    }

    const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
    const from = process.env.POSTMARK_FROM_EMAIL;
    const to = options.email;
    const messageStream = options.messageStream || 'outbound';

    const response =
      options.templateAlias || options.templateId
        ? await client.sendEmailWithTemplate({
            From: from,
            To: to,
            TemplateAlias: options.templateAlias,
            TemplateId: options.templateId,
            TemplateModel: options.templateModel || {},
            MessageStream: messageStream,
          })
        : await client.sendEmail({
            From: from,
            To: to,
            Subject: options.subject,
            TextBody: options.message,
            HtmlBody: options.htmlMessage || `<p>${options.message}</p>`,
            MessageStream: messageStream,
          });
    logger.info(`Message sent via Postmark: ${response.MessageID}`);

    return { success: true };
  } catch (error) {
    logger.error(`Error sending email: ${error.message}`);
    return { success: false, error };
  }
};

export default sendEmail;