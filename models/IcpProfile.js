import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';

const nullableRange = {
  min: { type: Number },
  max: { type: Number },
};
const icpProfileSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    professional_profile_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProfessionalProfile',
      required: true,
      index: true,
    },
    professional_type: {
      type: String,
      enum: PROFESSIONAL_TYPE_VALUES,
      required: true,
    },
    client_types: { type: [{ type: String }], default: undefined },
    price_range: nullableRange,
    property_types: { type: [{ type: String }], default: undefined },
    service_areas: { type: [{ type: String }], default: undefined },
    timeline_preference: { type: [{ type: String }], default: undefined },
    loan_types: { type: [{ type: String }], default: undefined },
    credit_range_preference: { type: [{ type: String }], default: undefined },
    income_preference: { type: [{ type: String }], default: undefined },
    loan_size_range: nullableRange,
    transaction_types: { type: [{ type: String }], default: undefined },
    preferred_property_values: nullableRange,
    is_configured: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
icpProfileSchema.index(
  { professional_profile_id: 1, is_active: 1 },
  { unique: true, partialFilterExpression: { is_active: true } }
);

export default mongoose.model('IcpProfile', icpProfileSchema);
