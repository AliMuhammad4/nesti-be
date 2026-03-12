import mongoose from 'mongoose';

const visitorSchema = new mongoose.Schema(
  {
    uuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    embed_token: {
      type: String,
    },
    user_agent: {
      type: String,
    },
    client_ip: {
      type: String,
    },
    last_seen_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Visitor', visitorSchema);
