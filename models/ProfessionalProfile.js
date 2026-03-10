import mongoose from 'mongoose';

const professionalProfileSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  professional_type: {
    type: String,
    enum: ['agent', 'lawyer', 'mortgage_broker'],
    default: 'agent',
  },
  full_name: {
    type: String,
  },
  website: {
    type: String,
  },
  certificates: [
    {
      type: String,
    },
  ],
  phone: {
    type: String,
  },
  location: {
    type: String,
  },
  target_neighborhoods: {
    type: String,
  },
  experience: {
    type: String,
  },
  calendly_link: {
    type: String,
  },
  bio: {
    type: String,
  }
}, { timestamps: true });

export default mongoose.model('ProfessionalProfile', professionalProfileSchema);
