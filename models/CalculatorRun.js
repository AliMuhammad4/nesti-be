import mongoose from 'mongoose';

const calculatorRunSchema = new mongoose.Schema({
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatConversation',
    required: true,
  },
  type: {
    type: String,
    enum: ['mortgage', 'closing'],
    required: true,
  },
  inputs: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  results: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  }
}, { timestamps: true });

export default mongoose.model('CalculatorRun', calculatorRunSchema);
