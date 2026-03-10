import mongoose from 'mongoose';

const buyerProfileSchema = new mongoose.Schema({
  full_name: {
    type: String,
  },
  email: {
    type: String,
  },
  phone: {
    type: String,
  },
  property_address: {
    type: String,
  },
  budget: {
    type: String,
  },
  timeline: {
    type: String,
  },
  total_score: {
    type: Number,
    default: 0,
  }
}, { timestamps: true });

export default mongoose.model('BuyerProfile', buyerProfileSchema);
