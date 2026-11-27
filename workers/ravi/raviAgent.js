import { voice } from '@livekit/agents';
import { pacedReply } from '../../services/proChat/replyPace.js';

function chatHasCue(chatCtx, cue) {
  const items = chatCtx?.items || chatCtx?.messages || [];
  return items.some((item) => item?.role === 'system' && String(item?.textContent || item?.content || '').includes(cue));
}

function withCue(chatCtx, cue) {
  const copy = chatCtx.copy();
  copy.addMessage({ role: 'system', content: cue });
  return copy;
}

export class RaviAgent extends voice.Agent {
  constructor(options, skipTurn) {
    super(options);
    this.skipTurn = skipTurn;
  }

  async onUserTurnCompleted(chatCtx, newMessage) {
    if (this.skipTurn?.(newMessage)) throw new voice.StopResponse();
    // Only when the language just changed. Adding the cue here throws away
    // an early reply that started in the old language, and the one new reply
    // sees the cue. An ordinary English turn does not touch the chat.
    const cue = typeof this.replyCue === 'function' ? this.replyCue() : '';
    if (!cue || this.replySawCue) return;
    this.replySawCue = true;
    chatCtx.addMessage({ role: 'system', content: cue });
  }

  async llmNode(chatCtx, toolCtx, modelSettings) {
    const cue = typeof this.replyCue === 'function' ? this.replyCue() : '';
    this.replySawCue = Boolean(cue);
    const langCtx = cue && !chatHasCue(chatCtx, cue) ? withCue(chatCtx, cue) : chatCtx;
    const steer = [
      typeof this.pipelineCue === 'function' ? this.pipelineCue() : '',
      typeof this.stateCue === 'function' ? this.stateCue() : '',
    ].filter(Boolean).join('\n');
    const replyCtx = steer ? withCue(langCtx, steer) : langCtx;
    const open = () => voice.Agent.default.llmNode(this, replyCtx, toolCtx, modelSettings);
    if (!this.pace) return open();
    return pacedReply(open, {
      pace: this.pace,
      canFill: () => this.session?.userState !== 'speaking' && this.session?.agentState !== 'speaking',
      onEvent: this.onSlowReply,
    });
  }

  async ttsNode(text, modelSettings) {
    return voice.Agent.default.ttsNode(this, text, modelSettings);
  }
}
