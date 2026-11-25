import { AudioByteStream, tts } from '@livekit/agents';
import { elevenLabsKey } from '../raviVoiceTts.js';
import { text } from './text.js';

async function playAudio(stream, response, requestId, final = true) {
  const audio = new AudioByteStream(24000, 1);
  const reader = response.body.getReader();
  let lastFrame;
  const sendLast = (isFinal) => {
    if (!lastFrame) return;
    stream.queue.put({ requestId, segmentId: requestId, frame: lastFrame, final: isFinal });
    lastFrame = undefined;
  };
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    for (const frame of audio.write(step.value)) {
      sendLast(false);
      lastFrame = frame;
    }
  }
  for (const frame of audio.flush()) {
    sendLast(false);
    lastFrame = frame;
  }
  sendLast(final);
}

export class CloneVoice extends tts.TTS {
  label = 'elevenlabs.TTS';
  constructor(voiceId, speed = 1) {
    super(24000, 1, { streaming: true });
    this.voiceId = voiceId;
    this.speed = speed;
  }
  get model() {
    return 'eleven_flash_v2_5';
  }
  get provider() {
    return 'elevenlabs';
  }
  synthesize() {
    throw new Error('Cloned voice uses the streaming path.');
  }
  stream() {
    return new CloneVoiceStream(this);
  }
}

class CloneVoiceStream extends tts.SynthesizeStream {
  label = 'elevenlabs.SynthesizeStream';
  constructor(parent) {
    super(parent);
    this.voiceId = parent.voiceId;
    this.speed = parent.speed;
  }
  async run() {
    const requestId = `${Date.now()}`;
    let pending = '';
    for await (const chunk of this.input) {
      if (chunk === tts.SynthesizeStream.FLUSH_SENTINEL) {
        if (pending) await this.speak(pending, requestId);
        pending = '';
        continue;
      }
      pending += chunk;
      const cut = pending.search(/[.!?۔؟।][^.!?۔؟।]*$/);
      if (cut >= 0 && pending.slice(0, cut + 1).trim().length >= 12) {
        const sentence = pending.slice(0, cut + 1);
        pending = pending.slice(cut + 1);
        await this.speak(sentence, requestId);
      }
    }
    if (pending) await this.speak(pending, requestId);
  }
  async speak(line, requestId) {
    const spoken = text(line);
    if (!spoken) return;
    this.markStarted();
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: spoken,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: this.speed || 1 },
        }),
        signal: this.abortSignal,
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(`Cloned voice failed (${response.status})`);
    }
    await playAudio(this, response, requestId);
  }
}
