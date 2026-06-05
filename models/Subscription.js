import mongoose from 'mongoose';

export const SUBSCRIPTION_PLAN_KEYS = ['basic', 'standard', 'enterprise'];

export const SUBSCRIPTION_STATUSES = [
  'free_trial',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'expired',
];

const subscriptionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    stripe_customer_id: {
      type: String,
      default: '',
    },
    stripe_subscription_id: {
      type: String,
      default: '',
    },
    stripe_price_id: {
      type: String,
      default: '',
    },
    plan_key: {
      type: String,
      enum: SUBSCRIPTION_PLAN_KEYS,
      default: 'basic',
      index: true,
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: 'free_trial',
      index: true,
    },
    current_period_start: {
      type: Date,
      default: null,
    },
    current_period_end: {
      type: Date,
      default: null,
    },
    cancel_at_period_end: {
      type: Boolean,
      default: false,
    },
    pending_plan_key: {
      type: String,
      enum: [...SUBSCRIPTION_PLAN_KEYS, ''],
      default: '',
      index: true,
    },
    pending_plan_effective_at: {
      type: Date,
      default: null,
    },
    stripe_subscription_schedule_id: {
      type: String,
      default: '',
    },
    trial_start: {
      type: Date,
      default: null,
    },
    trial_end: {
      type: Date,
      default: null,
    },
    latest_invoice_id: {
      type: String,
      default: '',
    },
    last_payment_status: {
      type: String,
      default: '',
    },
    last_stripe_event_id: {
      type: String,
      default: '',
    },
    last_synced_at: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

subscriptionSchema.index(
  { stripe_subscription_id: 1 },
  {
    unique: true,
    partialFilterExpression: { stripe_subscription_id: { $type: 'string', $ne: '' } },
  },
);

subscriptionSchema.index(
  { stripe_customer_id: 1 },
  {
    partialFilterExpression: { stripe_customer_id: { $type: 'string', $ne: '' } },
  },
);

export default mongoose.model('Subscription', subscriptionSchema);
