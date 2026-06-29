import mongoose from 'mongoose';

export const CLIENT_TIER_KEYS = ['basic', 'standard', 'pro'];

export const CLIENT_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
];

const clientSubscriptionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    tier: {
      type: String,
      enum: CLIENT_TIER_KEYS,
      required: true,
      index: true,
    },
    stripe_subscription_id: {
      type: String,
      required: true,
    },
    stripe_customer_id: {
      type: String,
      required: true,
    },
    stripe_price_id: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: CLIENT_SUBSCRIPTION_STATUSES,
      default: 'active',
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
    last_synced_at: {
      type: Date,
      default: null,
    },
    last_stripe_event_id: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

clientSubscriptionSchema.index(
  { stripe_subscription_id: 1 },
  {
    unique: true,
    partialFilterExpression: { stripe_subscription_id: { $type: 'string', $ne: '' } },
  }
);

clientSubscriptionSchema.index(
  { stripe_customer_id: 1 },
  {
    partialFilterExpression: { stripe_customer_id: { $type: 'string', $ne: '' } },
  }
);

export default mongoose.model('ClientSubscription', clientSubscriptionSchema);
