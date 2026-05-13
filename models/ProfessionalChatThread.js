import mongoose from 'mongoose';

function normalizeParticipantIds(ids) {
  const uniq = Array.from(
    new Set((Array.isArray(ids) ? ids : []).map((v) => String(v || '').trim()).filter(Boolean))
  );
  uniq.sort(); // stable + deterministic across environments
  return uniq;
}

const professionalChatThreadSchema = new mongoose.Schema(
  {
    /** Exactly two professional user ids for 1:1 chat. */
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2,
        message: 'participants must contain exactly 2 users',
      },
      index: true,
      required: true,
    },
    /** Deterministic unique key for (userA,userB) pair. */
    participants_key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    last_message_at: {
      type: Date,
      default: null,
      index: true,
    },
    last_message_text: {
      type: String,
      default: null,
    },
    last_message_sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

professionalChatThreadSchema.pre('validate', function () {
  const ids = normalizeParticipantIds(this.participants);
  if (ids.length === 2) {
    this.participants = ids.map((s) => new mongoose.Types.ObjectId(s));
    this.participants_key = `${ids[0]}:${ids[1]}`;
  }
  if (typeof this.last_message_text === 'string') {
    const t = this.last_message_text.trim();
    this.last_message_text = t ? t.slice(0, 280) : null;
  }
});

export default mongoose.model('ProfessionalChatThread', professionalChatThreadSchema);

