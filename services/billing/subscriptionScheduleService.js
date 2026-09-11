import Subscription from '../../models/Subscription.js';
import {
  invoiceRequiresPayment,
  normalizeStripeId,
} from './subscriptionShared.js';

export async function voidOrDeleteUnpaidInvoice(stripe, invoice) {
  if (!invoiceRequiresPayment(invoice)) return;
  const status = String(invoice.status || '').toLowerCase();
  if (status === 'draft') {
    await stripe.invoices.del(invoice.id);
    return;
  }
  await stripe.invoices.voidInvoice(invoice.id);
}

export async function clearPendingScheduleIfAny(stripe, subscription, attachedScheduleId = '') {
  const scheduleId = String(subscription?.stripe_subscription_schedule_id || attachedScheduleId || '').trim();
  if (!scheduleId) return;
  try {
    await stripe.subscriptionSchedules.release(scheduleId);
  } catch (error) {
    if (error?.code !== 'resource_missing') throw error;
  }
  await Subscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        pending_plan_key: '',
        pending_plan_effective_at: null,
        stripe_subscription_schedule_id: '',
      },
    },
  );
}

export async function getOrCreateSubscriptionSchedule(stripe, stripeSubscription, localScheduleId = '') {
  const attachedScheduleId = normalizeStripeId(stripeSubscription.schedule);
  const preferredScheduleId = String(localScheduleId || attachedScheduleId || '').trim();
  const retrieveUsableSchedule = async (scheduleId) => {
    if (!scheduleId) return null;
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      if (['completed', 'released', 'canceled'].includes(String(schedule.status || ''))) {
        return null;
      }
      return schedule;
    } catch (error) {
      if (error?.code === 'resource_missing') return null;
      throw error;
    }
  };

  const existingSchedule = await retrieveUsableSchedule(preferredScheduleId);
  if (existingSchedule) return existingSchedule;
  if (attachedScheduleId && attachedScheduleId !== preferredScheduleId) {
    const attachedSchedule = await retrieveUsableSchedule(attachedScheduleId);
    if (attachedSchedule) return attachedSchedule;
  }

  try {
    return await stripe.subscriptionSchedules.create({
      from_subscription: normalizeStripeId(stripeSubscription),
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.includes('already attached to a schedule')) throw error;
    const refreshedSubscription = await stripe.subscriptions.retrieve(
      normalizeStripeId(stripeSubscription),
    );
    const refreshedSchedule = await retrieveUsableSchedule(
      normalizeStripeId(refreshedSubscription.schedule),
    );
    if (refreshedSchedule) return refreshedSchedule;
    throw error;
  }
}
