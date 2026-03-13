import mongoose from 'mongoose';

const leadProfileSchema = new mongoose.Schema(
  {
    intent: {
      type: String,
      enum: ['buy', 'sell'],
      required: true,
    },

    // core contact
    full_name: { type: String },
    email: { type: String },
    phone: { type: String },

    // property + requirements
    property_address: { type: String },
    location: { type: String },
    budget: { type: String },
    expected_price: { type: String },
    timeline: { type: String },
    bedrooms: { type: String },
    bathrooms: { type: String },
    square_footage: { type: String },
    property_type: { type: String },

    // property preference matching data (spec #12)
    must_have_features: { type: String },
    parking_required: { type: String, enum: ['yes', 'no', ''], default: '' },
    backyard_needed: { type: String, enum: ['yes', 'no', ''], default: '' },
    school_district_important: { type: String, enum: ['yes', 'no', ''], default: '' },

    // CRM contact preferences (spec #11)
    preferred_contact_method: { type: String },
    best_time_to_contact: { type: String },

    // qualification signals captured during conversation
    mortgage_status: { type: String },
    realtor_status: { type: String },
    motivation_reason: { type: String },
    viewing_readiness: { type: String },
    living_situation: { type: String },
    urgency_readiness: { type: String },

    // meta
    source: { type: String, default: 'chatbot' },
    total_score: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('LeadProfile', leadProfileSchema);
