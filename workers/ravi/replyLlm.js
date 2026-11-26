import { llm } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import logger from '../../utils/logger.js';
import { text } from './text.js';

const REPLY_LLM_OPTIONS = { temperature: 0.6, maxCompletionTokens: 300 };
export const REPLY_MODEL = text(process.env.RAVI_REPLY_MODEL) || 'gpt-4o-mini';

// One hop: this laptop straight to OpenAI. The LiveKit route was a second
// hop (laptop, then LiveKit, then OpenAI) and never reused the saved script,
// so every answer paid the long trip again.
export function replyLlm() {
  return new openai.LLM({ model: REPLY_MODEL, ...REPLY_LLM_OPTIONS });
}

// Open the connection and store the script while the greeting is playing,
// so the first real answer does not pay for that trip.
export function warmReplyModel(model, instructions) {
  if (!model?.chat || model.warmed || !text(instructions)) return;
  model.warmed = true;
  try {
    const ctx = llm.ChatContext.empty();
    ctx.addMessage({ role: 'system', content: text(instructions) });
    ctx.addMessage({ role: 'user', content: 'Hi' });
    const stream = model.chat({ chatCtx: ctx });
    const it = stream[Symbol.asyncIterator]();
    it.next().then(() => {
      stream.close?.();
      logger.info(`Ravi reply model is warm (${REPLY_MODEL})`);
    }).catch(() => {});
  } catch {
    // The first real answer opens the connection instead.
  }
}
