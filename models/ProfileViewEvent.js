import mongoose from 'mongoose';

const profileViewEventSchema = new mongoose.Schema({
  // Professional being viewed
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  
  // Visitor information
  visitor_id: {
    type: String,
    required: true,
    index: true,
  },
  
  visitor_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  
  // Event details
  event_type: {
    type: String,
    enum: [
      'profile_view',
      'listing_view',
      'listing_click',
      'listing_save',
      'service_click',
      'cta_click',
      'chatbot_open',
      'consultation_request',
      'contact_click',
      'social_click',
      'partner_click',
    ],
    required: true,
    index: true,
  },
  
  // Event-specific data
  event_data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  
  // Session tracking
  session_id: {
    type: String,
    required: true,
    index: true,
  },
  
  // Request metadata
  referrer: {
    type: String,
    default: null,
  },
  
  user_agent: {
    type: String,
    default: null,
  },
  
  ip_address: {
    type: String,
    default: null,
  },
  
  // Timing metadata
  duration_seconds: {
    type: Number,
    default: null,
  },
  
  // Related entities (optional, depends on event_type)
  listing_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    default: null,
  },
  
  service_id: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  
  cta_type: {
    type: String,
    default: null,
  },
  
  // Traffic source categorization
  traffic_source: {
    type: String,
    enum: ['direct', 'referral', 'social', 'search', 'other'],
    default: 'direct',
  },
  
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
  },
  
}, { timestamps: false });

// Compound index for efficient queries by user and date
profileViewEventSchema.index({ user_id: 1, timestamp: -1 });

// Index for session-based queries
profileViewEventSchema.index({ session_id: 1, timestamp: 1 });

// Index for visitor tracking
profileViewEventSchema.index({ visitor_id: 1, timestamp: -1 });

// Index for event type analysis
profileViewEventSchema.index({ user_id: 1, event_type: 1, timestamp: -1 });

// TTL index to auto-delete old events after 90 days (data retention policy)
profileViewEventSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

export default mongoose.model('ProfileViewEvent', profileViewEventSchema);
