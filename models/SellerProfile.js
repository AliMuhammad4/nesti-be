import mongoose from 'mongoose';

const sellerProfileSchema = new mongoose.Schema({
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
  target_price: {
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

export default mongoose.model('SellerProfile', sellerProfileSchema);
