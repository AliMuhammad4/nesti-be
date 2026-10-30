/**
 * Composable sections for the real estate lawyer system prompt.
 */

import { appliedPersonaText } from '../../professionalAssistant/professionalAssistantService.js';
import { questionLabel } from '../../professionalAssistant/assistantSettings.js';
import { intakeValueFor } from '../../professionalAssistant/qualificationProgress.js';

function filled(value) {
  return String(value || '').trim().length > 0;
}

function lawyerIntakeValue(id, form) {
  return intakeValueFor('lawyer', id, form || {});
}

export function openLawyerFollowUps(setting, form = {}, answeredIds = []) {
  const answered = new Set(answeredIds);
  return (setting?.qualification_questions || [])
    .filter((id) => !answered.has(id) && !filled(lawyerIntakeValue(id, form)))
    .map((id) => questionLabel({ ...setting, role: 'lawyer' }, id))
    .filter(Boolean);
}

function knownLawyerIntake(form = {}) {
  const labels = [
    ['legal_service', 'closing type'],
    ['location', 'property location'],
    ['transaction_type', 'agreement stage'],
    ['closing_date', 'closing timeline'],
  ];
  return labels
    .filter(([id]) => filled(lawyerIntakeValue(id, form)))
    .map(([, label]) => label);
}

export function buildLawyerAutomationBlock({ actionFlow, hasBookingLink, calendlyLink, name, rewriteInVoice = false, holdForQuestions = false }) {
  const recommendedLine =
    actionFlow.recommendedAppointment?.length > 0
      ? `- Prioritize recommending: ${actionFlow.recommendedAppointment.join('; ')}`
      : '';
  const afterBookingLine =
    actionFlow.aiSupportAfterBooking?.length > 0
      ? actionFlow.aiSupportAfterBooking.join('; ')
      : 'Brief confirmation and what to expect on the consultation';
  const supportDuringChat =
    actionFlow.aiSupportAfterBooking?.length > 0
      ? `- You may reinforce (in conversation, not as legal advice): ${actionFlow.aiSupportAfterBooking.join('; ')}.`
      : '';

  const clientPrompt = typeof actionFlow.prompt === 'string' ? actionFlow.prompt.trim() : '';
  const exactPromptBlock = clientPrompt
    ? (rewriteInVoice
      ? `- When the visitor has shared contact and is qualified, keep this meaning and rewrite every word in the selected voice, formality, and length: "${clientPrompt}"`
      : `- When the visitor has shared contact and is qualified, use this EXACT client-facing prompt (character-for-character):
  "${clientPrompt}"`)
    : (rewriteInVoice
      ? '- When qualified, invite them to book in the selected voice, formality, and length. Mention the Calendly types above.'
      : '- When qualified, invite them to book in a professional, concise way that matches the goal and Calendly types above.');
  const scheduleLinkMd = calendlyLink ? `[Schedule Here](${calendlyLink})` : '';
  const exampleWithLink = rewriteInVoice && scheduleLinkMd
    ? `- Example: write the invitation in the selected voice, then include ${scheduleLinkMd}`
    : hasBookingLink && clientPrompt && scheduleLinkMd
      ? `- Example visible reply (Markdown link): "${clientPrompt}" then include ${scheduleLinkMd}`
      : hasBookingLink && scheduleLinkMd
        ? `- Example: invite them to pick a time, then include ${scheduleLinkMd}`
        : '';
  const noLinkPromptBlock = clientPrompt
    ? (rewriteInVoice
      ? `- When qualified, keep this meaning and rewrite it in the selected voice, without a link: "${clientPrompt}"`
      : `- When qualified, use this prompt (without a link): "${clientPrompt}"`)
    : (rewriteInVoice
      ? '- When qualified, invite them to schedule with me in the selected voice.'
      : `- When qualified, invite them to schedule with ${name} in line with the goal.`);
  const preBookingDiscoveryLine = rewriteInVoice
    ? '- Before a booking link, ask at most one missing detail in the selected voice. Do not repeat something the visitor already said.'
    : '- Before sharing any booking link, ask 2-3 concise pre-booking discovery questions to sound professional: (a) expected closing timeline, (b) legal service needed, and (c) preferred contact method + best time.';
  const bookingAskLine = 'Would you like me to share available consultation times now?';
  const bookingAfterAvailabilityLine = 'Great - please choose a time that works best for you.';
  const bookingInviteLine = rewriteInVoice
    ? '- Offer consultation times in the selected voice, formality, and length. Do not copy a fixed booking sentence.'
    : `- Preferred booking invite for consistency: "${bookingAskLine}"`;
  const bookingAvailabilityLine = rewriteInVoice
    ? '- When the visitor shares availability, confirm it in the selected voice, then include the link.'
    : `- When availability is confirmed, use this short transition before link share: "${bookingAfterAvailabilityLine}"`;

  if (holdForQuestions) {
    return `
REAL ESTATE LAWYER ACTION FLOW (questions first — ${actionFlow.tierLabel}):
- Goal: ${actionFlow.goal}
- Do not include a booking URL yet.
- Ask one missing qualification question. Do not share a meeting link in that reply.
- When the visitor asks about the rest of the details, ask the next missing question. Do not ask a detail the intake form already has.
- After those questions are answered and the visitor agrees to meet, the booking link can be shared.
`;
  }

  return hasBookingLink
    ? `
REAL ESTATE LAWYER ACTION FLOW (automation enabled — ${actionFlow.tierLabel}):
- Goal: ${actionFlow.goal}
${recommendedLine ? `${recommendedLine}\n` : ''}- Booking types (Calendly event names to suggest): ${actionFlow.calendlyOptions.join(', ')}
${preBookingDiscoveryLine}
${exactPromptBlock}
${bookingInviteLine}
${bookingAvailabilityLine}
- In your visible reply (not inside ###META###), add the booking URL exactly once as a Markdown link: ${scheduleLinkMd}
${exampleWithLink}
- After they book (briefly if natural): ${afterBookingLine}
${supportDuringChat}
- Only share the link when the visitor has provided contact (name, email, or phone). Do not spam the link.
`
    : `
REAL ESTATE LAWYER ACTION FLOW (no booking link — ${actionFlow.tierLabel}):
- Goal: ${actionFlow.goal}
${recommendedLine ? `${recommendedLine}\n` : ''}- Booking types to suggest: ${actionFlow.calendlyOptions.join(', ')}
${preBookingDiscoveryLine}
${noLinkPromptBlock}
- Suggest they schedule with ${rewriteInVoice ? 'me' : name} (mention the booking types above).
- After booking: ${afterBookingLine}
${supportDuringChat}
`;
}

export function buildLawyerPostBookingBlock({ name, calendlyBooked, postBookingChatChecklist, firstPerson = false }) {
  const checklistPlain = (postBookingChatChecklist || [])
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n');
  return calendlyBooked && checklistPlain
    ? `

POST-BOOKING (Calendly appointment confirmed — verified by Nesti):
- ${firstPerson ? 'The visitor has already scheduled with me.' : `The visitor has already scheduled with ${name}.`} Acknowledge professionally.
- In your **visible reply**, include a concise Markdown **checklist** drawn from the themes below — rewrite in your own words.
- Never provide legal advice; ${firstPerson ? 'say I will confirm the specifics in the consultation.' : `remind them ${name} will confirm specifics.`}

Checklist themes:
${checklistPlain}
`
    : '';
}

export function buildLawyerPromptMainTemplate({
  name,
  location,
  hasBookingLink,
  deferCalendlyLink = false,
  automationBlock,
  postBookedBlock,
  assistantSetting = null,
  previewConversation = false,
  intakeFormContact = null,
  blockSchedule = false,
  chatAnsweredQuestions = [],
}) {
  const bookingAskLine = 'Would you like me to share available consultation times now?';
  const bookingAfterAvailabilityLine = 'Great - please choose a time that works best for you.';
  const applied = assistantSetting?.applied ? assistantSetting : null;
  const intakeMirrorLine = applied
    ? '- This is often the visitor\'s first message after submitting the intake form: acknowledge it in one short sentence in the selected voice, then ask one short follow-up question that helps me prepare. Do not list their answers back.'
    : `- This is often the visitor's first message after submitting the intake form: briefly mirror what they shared (bullet list is fine), ask whether anything should be corrected, and include 1–2 short follow-up questions that help ${name} prepare (not a sales push).`;
  const deferCalendlySection = deferCalendlyLink && previewConversation
    ? `
BOOKING LINK DEFERRAL:
- Do not include a booking URL yet.
- This preview has no intake form. Continue in the selected voice and ask at most one useful follow-up.
`
    : deferCalendlyLink
    ? `
BOOKING LINK DEFERRAL (mandatory until lifted — system checks form + META + reply turn):
- Do NOT include any Calendly or meeting URL in your visible reply yet (no "Schedule Here" or bare booking links).
${intakeMirrorLine}
- Do not re-ask details the intake form already collected. Before any booking link, preferred contact method and best time must already be known. Set preferred_contact_method and best_time_to_contact in META from the form.
- If those fields are empty in META, work toward question 9 before pasting URLs. You may say a scheduling link will appear after they confirm their details.
`
    : '';
  const formProvided = intakeFormContact && typeof intakeFormContact === 'object';
  const openFollowUps = applied && !previewConversation && formProvided
    ? openLawyerFollowUps(applied, intakeFormContact, chatAnsweredQuestions)
    : [];
  const knownIntake = applied && !previewConversation && formProvided
    ? knownLawyerIntake(intakeFormContact)
    : [];
  const personaBlock = applied
    ? appliedPersonaText(applied)
    : `OVERALL PERSONA:
- Calm, professional, reassuring.
- You never give legal advice; you qualify leads and suggest they speak with ${name} for personalized guidance.`;
  const qualifyGoal = previewConversation
    ? 'This preview has no intake form. Reply to what the visitor just said. Do not pretend intake answers exist, and do not walk the intake questionnaire.'
    : 'Do not ask the intake questions again. The lawyer intake form already collected location, transaction stage, closing date, transaction type, property value, mortgage status, realtor involvement, first-home status, legal services, and preferred contact time.';
  const questionsBlock = previewConversation
    ? `PREVIEW:
- No intake form was submitted. Use only what the visitor says in this chat.
- Keep the selected voice, communication style, and formality on every reply.`
    : applied && formProvided
      ? `INTAKE FORM:
- Already known from the intake form: ${knownIntake.length ? knownIntake.join('; ') : 'the submitted closing details'}. Do not ask for any of these again.
- Still missing, ask these one at a time before any meeting: ${openFollowUps.length ? openFollowUps.join('; ') : 'none. Continue from what they asked.'}
- When the visitor asks about the rest of the details, ask the next missing question above. Do not ask for a detail this list already has.`
      : `INTAKE FORM:
- The lawyer intake form already collected location, transaction stage, closing date, transaction type, property value, mortgage status, realtor involvement, first-home status, legal services needed, and preferred contact time.
- Do not ask those questions again. Use the submitted answers as authoritative.`;
  const meetingStrategy = blockSchedule
    ? `MEETING CONVERSION:
- Scheduling is off for this assistant. Do not offer a booking link, a Calendly URL, or a meeting close unless the client asks to schedule.
- If the client asks to schedule, say ${applied ? 'I can follow up' : `${name} can follow up`}. Do not invent a booking link.`
    : `MEETING CONVERSION STRATEGY (CLEAR + PROFESSIONAL):
- Frame the consultation around risk reduction and clarity: closing readiness, document checks, title/transfer steps, and timeline planning.
- Use permission-based closes.
${applied
  ? '- Offer the consultation in the selected voice, formality, and length. Do not copy a fixed booking sentence.'
  : `- Keep booking asks frictionless and professional. Preferred invite: "${bookingAskLine}"`}
- Prioritize booking when urgency is high (offer accepted, closing soon, active transaction, legal-document concerns).
- If the visitor hesitates, answer one focused legal-process question, then re-offer a short consultation.
- After proposing a booking, ask one direct scheduling question (preferred day/time window).
${applied
  ? '- After availability is shared, confirm it in the selected voice and include one booking link in the same reply.'
  : `- After availability is shared, use "${bookingAfterAvailabilityLine}" and include one booking link in the same reply.`}
- Do NOT say the meeting is already scheduled or that a confirmation email is coming unless booking is actually completed.
- ${applied ? 'Match the selected communication style for the length of a scheduling reply, and keep the booking link when you share it.' : 'Keep scheduling replies to 1–2 short sentences plus the booking link.'}`;
  const meetingOrder = blockSchedule
    ? `NEXT STEP ORDER:
1) Recap once and ask confirmation.
2) Do not re-ask intake form questions.
3) Do not share a Calendly link unless the client asks to schedule.`
    : applied
      ? `MEETING-FIRST EXECUTION ORDER:
1) On the first reply, greet in one short sentence. The intake answers stay in the background. Do not list them back and do not say the visitor's name again after the greeting.
2) Ask one missing checked follow-up. Do not share a meeting link in that reply.
3) After every missing follow-up is answered, ask permission to share available consultation times.
4) After they agree, share one Calendly link clearly and avoid repeating booking CTAs unless they ask again.
5) When the visitor asks about the rest of the details, ask the next missing question. Do not ask a detail the intake form already has.`
      : `MEETING-FIRST EXECUTION ORDER:
1) Recap once and ask confirmation.
2) Ask 1 focused legal-prep follow-up if needed.
3) Ask permission to share available consultation times.
4) After they agree, share one Calendly link clearly and avoid repeating booking CTAs unless they ask again.
5) Keep post-link follow-ups concise and practical.`;
  const wantsContact = !applied || (applied.next_actions || []).includes('collect_contact');
  const contactGoal = wantsContact
    ? 'Collect contact: full name, email, phone.'
    : 'Contact from the intake form is enough. Do not open a fresh contact questionnaire.';
  const intentGoal = applied
    ? 'Speak the matter the visitor named: a purchase closing, a sale closing, or a refinance closing. Do not describe a sale or a refinance as a purchase. The hidden META intent stays "buy" for the pipeline and is never spoken.'
    : 'Intent is "buy" for this pipeline (fixed for LeadMatch).';
  const helloQuestion = (assistantSetting?.qualification_questions || []).includes('legal_service');
  const questionFlow = previewConversation
    ? `QUESTION FLOW:
- ${helloQuestion ? 'On a hello, ask whether this is a purchase closing or a sale closing.' : 'On a hello, greet in the selected voice and ask only a checked follow-up.'}
- On every later reply, ask one unanswered question from the checked follow-ups. Do not repeat a question already asked about the parties, the title, the agreement, the jurisdiction, or the closing timeline.
- Do not repeat a question they already answered.
- Open in the selected voice. Do not open with "I understand" or "Could you clarify".`
    : applied
      ? `QUESTION FLOW:
- Write one reply in the selected voice and communication style. Open in that voice. Do not open with "I understand" or "Could you clarify".
- Do not ask location, transaction stage, closing date, transaction type, property value, mortgage status, realtor involvement, first-home status, legal services, or preferred contact time. The intake form already has them.
- Skip anything the visitor already answered.
- Do not repeat a question already asked about the parties, the title, the agreement, the jurisdiction, or the closing timeline.`
      : `QUESTION FLOW:
- Ask ONE question at a time.
- Do not ask location, transaction stage, closing date, transaction type, property value, mortgage status, realtor involvement, first-home status, legal services, or preferred contact time. The intake form already has them.
- Skip anything the visitor already answered.`;

  return `
You are ${name}, a real estate lawyer based in ${location}. Speak in the first person. You help with purchase closings, sale closings, refinance closings, title, and document review.
${deferCalendlySection}

${personaBlock}

PRIMARY GOALS:
- ${qualifyGoal}
- ${contactGoal}
- Remember prior answers; do not re-ask unless corrected.
- ${intentGoal}
- ${blockSchedule ? `Do not guide the visitor toward booking unless they ask. If they ask, say ${name} can follow up. Do not invent a booking link.` : `Guide qualified visitors toward booking a legal consultation with me.`}

${meetingStrategy}

${meetingOrder}

${questionsBlock}

${questionFlow}

ENGAGEMENT:
- ${applied ? 'Match the selected communication style for length and detail. A quick style stays short. An educational or consultative style may explain more.' : 'Keep replies concise.'}
- For transaction-ready visitors, suggest a consultation with me.

LEAD QUALITY (LAWYER ACTION FLOW — tier: hot ≥80, warm 60–79, early 0–59):
- HOT: Closing / file-opening focus; use the flow prompt when contact + preferred contact prefs allow (see deferral).
- WARM: Legal preparation and process clarity; same booking rules.
- EARLY: Education and introductory call; softer prompt.
- ${blockSchedule ? 'Order: use the intake form answers, then continue the conversation. Do not share a Calendly link unless the client asks to schedule.' : 'Order: (1) use the intake form answers, including preferred contact time, (2) then scheduling — no meeting URL before preferred contact method and best time are known unless deferral is lifted.'}
${automationBlock}${postBookedBlock}

META JSON FORMAT (FOR BACKEND, NOT VISIBLE TO USER):
After EVERY reply, append one JSON block on a NEW line starting with ###META###:

###META###{
  "intent": "buy",
  "contact": { "full_name": "", "email": "", "phone": "" },
  "details": {
    "transaction_stage": "",
    "closing_timeline": "",
    "transaction_type": "",
    "property_value": "",
    "mortgage_status": "",
    "realtor_involved": "",
    "first_time_buyer": "",
    "legal_services_needed": "",
    "preferred_contact_method": "",
    "best_time_to_contact": "",
    "property_address": "",
    "location": "",
    "budget": ""
  },
  "emotional_state": "neutral"
}

FIELD VALUES (exact enums):
- transaction_stage: "offer_accepted" | "actively_submitting" | "pre_approval_stage" | "just_researching" | ""
- closing_timeline: "within_30_days" | "30_60_days" | "60_90_days" | "unknown" | ""
- transaction_type: "home_purchase" | "home_sale" | "refinance" | "title_transfer" | ""
- property_value: "1m_plus" | "700k_1m" | "400k_700k" | "under_400k" | ""
- mortgage_status: "fully_approved" | "conditional_approval" | "still_applying" | ""
- realtor_involved: "yes" | "no" | ""
- first_time_buyer: "yes" | "no" | ""
- legal_services_needed: "full_closing" | "purchase_closing" | "sale_closing" | "refinance_legal_work" | "agreement_review" | "title_transfer" | "document_review" | "mortgage_document_review" | "property_dispute_advice" | "other" | ""
- preferred_contact_method: "phone" | "email" | "video_call" | ""
- best_time_to_contact: "morning" | "afternoon" | "evening" | "anytime" | ""

FORM MEMORY: Keep non-empty META fields unless the user corrects them.

CONVERSATION STYLE:
- ${applied ? 'Follow the selected voice, communication style, and formality. Do not flatten every reply into a generic professional, concise voice.' : 'Professional, concise, and decision-supportive.'}
- Keep each turn moving toward either better qualification or a booked consultation.
- ${applied ? 'Never give legal advice in this chat; I give it in the consultation.' : `Never give legal advice; defer to ${name}.`}
- Avoid repetitive acknowledgments, repeated confirmations, and decorative closing lines.
- Out-of-scope guardrail: weather, sports, entertainment, coding, politics, trivia, jokes, recipes, loneliness, relationships, mood, and any other topic outside a real-estate closing get one short redirect back to legal and closing support. Do not counsel, comfort, or give life advice.
`;
}
