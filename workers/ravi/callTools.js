import { llm } from '@livekit/agents';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import { persistSalesOutcome } from '../../services/proChat/voiceAgentTurnService.js';
import { prepareSignupLink } from '../../services/proChat/voiceSalesBrief.js';
import { text } from './text.js';

export function createCallTools(c) {
  const { callId, call, caller } = c;
  const recordOutcome = llm.tool({
    description: 'Save the sales result only after the caller clearly agrees, clearly declines, explicitly asks to be called back later, asks for a demo, or asks for a person. Wanting more information is not a callback: answer the question instead. Saving a result never ends the call. Do not call this when you only recommend a plan or during the greeting. Write plan and note in English. next_step: signup_link when they want to start, demo when they want a demo with the team, human_handoff when they want a person, summary_email when they agree to a summary email, do_not_call when they ask not to be called again. Set follow_up_consent true only when they said yes to a follow-up or summary.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['interested', 'callback', 'declined', 'plan_recommended'] },
        plan: { type: 'string' },
        note: { type: 'string' },
        next_step: { type: 'string', enum: ['', 'signup_link', 'demo', 'human_handoff', 'summary_email', 'do_not_call'] },
        follow_up_consent: { type: 'boolean' },
      },
      required: ['outcome'],
    },
    execute: async (args) => {
      c.pipeline?.noteOutcome({
        outcome: args?.outcome,
        plan: args?.plan,
        nextStep: text(args?.next_step),
        followUpConsent: args?.follow_up_consent === true,
      });
      const saved = await persistSalesOutcome({
        callId,
        outcome: args?.outcome,
        plan: args?.plan,
        note: args?.note,
        pipeline: c.pipeline?.snapshot(),
      });
      if (!saved.ok) return saved.message;
      c.outcomeSaved = true;
      const outcome = text(args?.outcome).toLowerCase();
      let next = 'Keep talking. Do not end the call.';
      if (outcome === 'interested') {
        const link = await prepareSignupLink({
          kind: call.voice_target_type === 'sales' ? 'professional' : 'client',
          userId: caller.userId,
          planLabel: args?.plan,
        });
        if (link.url) {
          await ProfessionalCall.updateOne({ _id: callId }, { $set: { voice_checkout_url: link.url } });
        }
        next = `${link.spoken} Do not read a web address.`;
      }
      if (outcome === 'callback') next = 'Confirm the follow-up in one sentence, then ask if there is anything else you can help with. Do not end the call.';
      if (text(args?.next_step) === 'demo') next = 'Say the Nesti team will reach out to book the demo, in one sentence, then ask if there is anything else. Do not end the call.';
      if (text(args?.next_step) === 'human_handoff') next = 'Say a person from the Nesti team will follow up on this, in one sentence, then ask if there is anything else. Do not end the call.';
      if (text(args?.next_step) === 'do_not_call') next = 'Confirm in one sentence that they will not be called again, then call end_call.';
      if (outcome === 'declined') {
        c.noteDecline();
        next = c.declines >= 2
          ? 'They declined again. Do not pitch. Say one short polite closing sentence, then call end_call.'
          : 'Say "No problem" in a few words and do not pitch, name, or offer any plan again unless they ask. Offer to answer any question.';
      }
      return `${next} Do not say the word saved. ${c.languageNow()}`;
    },
  });
  const endCall = llm.tool({
    description: 'Hang up the call after your closing line. Call it when the caller says bye or goodbye, asks to end or hang up, answers no to "anything else?", says they want nothing at all or are not interested, has declined twice, or is dismissive, rude, or abusive; and whenever you say a closing line such as "Take care" or "Goodbye". Do not call it for an unclear or cut-off phrase or when they want more information.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
    },
    execute: async (args) => {
      if (c.closing || c.closed) return 'The call is already ending. Say nothing more.';
      c.hangUpAfterSpeech(text(args?.reason) || 'end_call');
      return `The call ends after this. If you have not said goodbye yet, say one short, calm goodbye sentence with no question; otherwise say nothing. ${c.languageNow()}`;
    },
  });
  return { record_sales_outcome: recordOutcome, end_call: endCall };
}
