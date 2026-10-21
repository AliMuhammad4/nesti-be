import EmailDelivery from '../../models/EmailDelivery.js';
import sendEmail from '../../utils/sendEmail.js';

export const emailDeliveryDeps = { EmailDelivery, sendEmail };
const SENDING_LEASE_MS = 10 * 60 * 1000;

function duplicateKey(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function deliveryInput(options) {
  return {
    recipient: String(options.email || '').trim(),
    subject: String(options.subject || ''),
    text_body: String(options.message || ''),
    html_body: String(options.htmlMessage || ''),
    source: String(options.source || '').trim(),
  };
}

export async function sendIdempotentEmail(options = {}) {
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  const payload = deliveryInput(options);
  if (!idempotencyKey) throw new Error('An idempotency key is required for tracked email delivery.');
  if (!payload.recipient || !payload.subject || !payload.text_body) {
    throw new Error('Tracked email requires a recipient, subject, and text body.');
  }

  await emailDeliveryDeps.EmailDelivery.init();

  let delivery;
  try {
    delivery = await emailDeliveryDeps.EmailDelivery.create({
      idempotency_key: idempotencyKey,
      ...payload,
      status: 'sending',
      attempt_count: 1,
    });
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    const existing = await emailDeliveryDeps.EmailDelivery.findOne({ idempotency_key: idempotencyKey });
    if (!existing) throw error;
    if (existing.status === 'sent') {
      return { success: true, duplicate: true, id: existing.provider_message_id || undefined };
    }
    if (existing.status === 'sending') {
      const updatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (updatedAt && Date.now() - updatedAt >= SENDING_LEASE_MS) {
        const uncertain = await emailDeliveryDeps.EmailDelivery.findOneAndUpdate(
          { _id: existing._id, status: 'sending', updatedAt: existing.updatedAt },
          {
            $set: {
              status: 'uncertain',
              last_error: 'Delivery reservation expired before its result was recorded; verify provider status before retrying.',
            },
          },
          { returnDocument: 'after' },
        );
        if (uncertain) return { success: false, uncertain: true };
        const latest = await emailDeliveryDeps.EmailDelivery.findOne({ idempotency_key: idempotencyKey });
        if (latest?.status === 'sent') {
          return { success: true, duplicate: true, id: latest.provider_message_id || undefined };
        }
        if (latest?.status === 'uncertain') return { success: false, uncertain: true };
        if (latest?.status !== 'failed') return { success: false, inProgress: true };
        delivery = await emailDeliveryDeps.EmailDelivery.findOneAndUpdate(
          { _id: latest._id, status: 'failed' },
          {
            $set: { ...payload, status: 'sending', last_error: '' },
            $inc: { attempt_count: 1 },
          },
          { returnDocument: 'after' },
        );
        if (!delivery) return { success: false, inProgress: true };
      } else {
        return { success: false, inProgress: true };
      }
    } else if (existing.status === 'uncertain') {
      return { success: false, uncertain: true };
    } else {
      delivery = await emailDeliveryDeps.EmailDelivery.findOneAndUpdate(
        { _id: existing._id, status: 'failed' },
        {
          $set: { ...payload, status: 'sending', last_error: '' },
          $inc: { attempt_count: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!delivery) return { success: false, inProgress: true };
    }
  }

  let result;
  try {
    result = await emailDeliveryDeps.sendEmail({
      email: payload.recipient,
      subject: payload.subject,
      message: payload.text_body,
      htmlMessage: payload.html_body,
      idempotencyKey,
    });
  } catch (error) {
    await emailDeliveryDeps.EmailDelivery.updateOne(
      { _id: delivery._id, status: 'sending' },
      {
        $set: {
          status: 'uncertain',
          last_error: String(error?.message || 'Email send outcome could not be determined').slice(0, 1000),
        },
      },
    );
    throw error;
  }
  const update = result?.success
    ? {
      status: 'sent',
      provider_message_id: String(result.id || ''),
      last_error: '',
    }
    : result?.uncertain
      ? {
        status: 'uncertain',
        last_error: String(result?.error?.message || 'Email provider outcome is uncertain').slice(0, 1000),
      }
    : {
      status: 'failed',
      last_error: String(result?.error?.message || 'Email provider rejected the message').slice(0, 1000),
    };
  await emailDeliveryDeps.EmailDelivery.updateOne(
    { _id: delivery._id, status: 'sending' },
    { $set: update },
  );
  return result;
}
