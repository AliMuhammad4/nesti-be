import mongoose from 'mongoose';

const leadProfileSchema = new mongoose.Schema(
  {
    // buyer or sell side
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
    budget: { type: String },          // buyer budget or generic price range
    expected_price: { type: String },  // seller expected price (if applicable)
    timeline: { type: String },
    bedrooms: { type: String },
    bathrooms: { type: String },
    square_footage: { type: String },
    property_type: { type: String },

    // meta
    source: { type: String, default: 'chatbot' },
    total_score: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('LeadProfile', leadProfileSchema);

