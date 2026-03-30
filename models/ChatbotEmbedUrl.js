import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';

const chatbotEmbedUrlSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  widget_role: {
    type: String,
    enum: PROFESSIONAL_TYPE_VALUES,
  },
  allowed_domains: [{
    type: String,
  }],
  widget_settings: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  }
}, { timestamps: true });

export default mongoose.model('ChatbotEmbedUrl', chatbotEmbedUrlSchema);
