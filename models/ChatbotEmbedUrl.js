import mongoose from 'mongoose';

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
  allowed_domains: [{
    type: String,
  }],
  widget_settings: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  }
}, { timestamps: true });

export default mongoose.model('ChatbotEmbedUrl', chatbotEmbedUrlSchema);
