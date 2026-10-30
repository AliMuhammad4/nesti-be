const LAWYER_REPLY_DRIFT = /\b(buy or sell|buying or selling|looking to buy|looking to sell|selling a property|buying a property|property type|features or amenities|attract buyers)\b/i;
const LAWYER_FINANCING_TERMS = /\b(income verification|credit information|credit score|current mortgage|interest rate|loan application)\b/i;
const LAWYER_FINANCING_HANDOFF = /\b(lender|broker|bank)\b|\b(I do not|I don't|I don’t|not something I)\b/i;
const LAWYER_FINANCING_ASK = /\?|\b(share|provide|send|tell me|what is|what's|what’s|need)\b/i;

export function lawyerReplyDrifted(reply) {
  const text = String(reply || '');
  if (LAWYER_REPLY_DRIFT.test(text)) return true;
  return text.split(/(?<=[.!?])\s+/).some((sentence) => (
    LAWYER_FINANCING_TERMS.test(sentence)
    && !LAWYER_FINANCING_HANDOFF.test(sentence)
    && LAWYER_FINANCING_ASK.test(sentence)
  ));
}
