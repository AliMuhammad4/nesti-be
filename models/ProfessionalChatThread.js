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
    /** Thread type: direct message (2 users) or group (2+ users). */
    thread_type: {
      type: String,
      enum: ['dm', 'group'],
      default: 'dm',
      index: true,
    },
    /** Optional title for group chats. */
    title: {
      type: String,
      default: null,
      maxlength: 120,
    },
    /** Professional user ids for dm/group chat. */
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
      validate: {
        validator: function (v) {
          const n = Array.isArray(v) ? v.length : 0;
          if (this.thread_type === 'dm') return n === 2;
          return n >= 2;
        },
        message: 'participants must contain exactly 2 users for dm, or 2+ users for group',
      },
      index: true,
      required: true,
    },
    /** Users who previously left the group and can request rejoin. */
    left_participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      index: true,
    },
    /** Rejoin workflow requests for group chats. */
    rejoin_requests: {
      type: [
        new mongoose.Schema(
          {
            user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            status: {
              type: String,
              enum: ['pending', 'approved', 'rejected'],
              default: 'pending',
            },
            requested_at: { type: Date, default: Date.now },
            resolved_at: { type: Date, default: null },
            resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    /**
     * Unique key for the thread.
     * - dm: deterministic `${userA}:${userB}` (sorted) so we never create duplicates.
     * - group: generated unique `group:<id>` (groups are not deduped by participants).
     *
     * NOTE: This field is unique-indexed in production, so it must always be present.
     */
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

professionalChatThreadSchema.index({ participants: 1, last_message_at: -1, updatedAt: -1 });
professionalChatThreadSchema.index({ left_participants: 1, last_message_at: -1, updatedAt: -1 });

professionalChatThreadSchema.pre('validate', function () {
  const ids = normalizeParticipantIds(this.participants);
  this.participants = ids.map((s) => new mongoose.Types.ObjectId(s));
  const leftIds = normalizeParticipantIds(this.left_participants);
  this.left_participants = leftIds
    .filter((id) => !ids.includes(id))
    .map((s) => new mongoose.Types.ObjectId(s));

  const type = String(this.thread_type || 'dm').trim();
  this.thread_type = type === 'group' ? 'group' : 'dm';

  if (this.thread_type === 'dm' && ids.length === 2) {
    this.participants_key = `${ids[0]}:${ids[1]}`;
    this.title = null;
  }
  if (this.thread_type === 'group') {
    if (typeof this.title === 'string') {
      const t = this.title.trim();
      this.title = t ? t.slice(0, 120) : null;
    }
    if (!this.participants_key || typeof this.participants_key !== 'string') {
      this.participants_key = `group:${String(new mongoose.Types.ObjectId())}`;
    }
  }
  if (typeof this.last_message_text === 'string') {
    const t = this.last_message_text.trim();
    this.last_message_text = t ? t.slice(0, 280) : null;
  }
});

export default mongoose.model('ProfessionalChatThread', professionalChatThreadSchema);

