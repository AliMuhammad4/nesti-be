import mongoose from 'mongoose';

const landingChatSessionSchema = new mongoose.Schema(
  {
    session_id: { type: String, required: true, unique: true },
    audience_role: {
      type: String,
      required: true,
      enum: ['client', 'investor', 'agent', 'mortgage_broker', 'lawyer'],
    },
    expires_at: { type: Date, required: true },
  },
  { timestamps: true },
);

landingChatSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('LandingChatSession', landingChatSessionSchema);
