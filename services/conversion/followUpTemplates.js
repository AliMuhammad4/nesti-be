import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

const DEFAULT_TEMPLATES = {
  offer_meeting_slots:
    "Thanks for chatting — I'd love to connect for 15 minutes. Would [day/time option 1] or [day/time option 2] work? I can also send my calendar link if easier.",
  confirm_appointment:
    "Just confirming our upcoming call — you'll get a calendar invite shortly. If anything changes on your end, reply here and we'll reschedule.",
  call_now: null,
  personalized_email:
    "Hi — following up from our chat. I wanted to share a quick next step: [one specific offer]. Happy to answer any questions.",
  reengage:
    "Hi — checking in after our last chat. Is finding the right [home / loan / legal support] still a priority? Happy to help whenever you're ready.",
  preapproval_path:
    "To give you accurate options, could you share where you are with pre-approval (not started, in progress, or approved) and your target timeline?",
  matter_scope:
    "To scope next steps: what stage is the transaction in, and are there any firm dates (financing, inspection, closing) we should be aware of?",
  viewing_readiness:
    "Are you hoping to view properties this week? If so, what areas and price range should I prioritize — and anything that would stop you from making an offer?",
};

export function followUpTemplateForAction(actionId, ctx = {}) {
  const base = DEFAULT_TEMPLATES[actionId];
  if (base === undefined) return null;
  if (actionId === 'call_now') {
    return voicemailTemplate(ctx);
  }
  return base;
}
function voicemailTemplate(ctx) {
  const { intent = 'buy', professional_type: prof = PROFESSIONAL_TYPE.AGENT } = ctx;
  const topic =
    prof === PROFESSIONAL_TYPE.MORTGAGE_BROKER
      ? 'financing options'
      : prof === PROFESSIONAL_TYPE.LAWYER
        ? 'your transaction'
        : intent === 'sell'
          ? 'selling your place'
          : 'your home search';
  return `Hi, this is [your name] — I'm following up from your chat about ${topic}. I'll try again shortly; feel free to text or call me at [number].`;
}
