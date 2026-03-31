const mapGradeToTier = (grade) => {
  if (grade === 'hot') return 'hot';
  if (grade === 'warm') return 'warm';
  return 'early';
};

const HOT = {
  goal: 'File opening / closing consultation',
  recommendedAppointment: [],
  prompt:
    "You're close to completing your transaction. Book a closing consultation with a real estate lawyer to prepare your documents.",
  calendlyOptions: ['Real Estate Closing Consultation', 'Purchase Agreement Review'],
  aiSupportAfterBooking: [
    'Closing checklist (conditions, title, lender instructions, adjustments)',
    'Document preparation guide (IDs, agreements of purchase and sale, lender correspondence)',
  ],
  postBookingAutomations: ['lawyer_closing_checklist'],
  postBookingChatChecklist: [
    'Confirm your closing date and any outstanding conditions on your agreement.',
    'Gather government-issued ID and a complete copy of your agreement of purchase and sale.',
    'Have lender instructions and any mortgage documents your lawyer requested.',
    'Note questions about title, closing costs, and adjustments before your appointment.',
  ],
};

const WARM = {
  goal: 'Legal preparation',
  recommendedAppointment: [],
  prompt:
    "You're making solid progress. Book a legal consultation to prepare for closing and understand the steps ahead with your lawyer.",
  calendlyOptions: ['Home Buying Legal Consultation', 'Closing Process Overview'],
  aiSupportAfterBooking: [
    'What legal review typically covers before closing (not legal advice)',
    'How the closing process fits with your offer and lender timeline',
  ],
  postBookingAutomations: ['lawyer_legal_preparation'],
  postBookingChatChecklist: [
    'Rough timeline from offer to closing and where legal fits in.',
    'Any conditions or subjects still open on your transaction.',
    'Questions about title, transfers, or documents you should start collecting.',
    'Whether you are working with a realtor and lender so your lawyer can coordinate.',
  ],
};

const EARLY = {
  goal: 'Legal education',
  recommendedAppointment: [],
  prompt:
    "Let's start with a short call to understand your situation and explain how a real estate lawyer helps — no pressure, just clarity.",
  calendlyOptions: ['Real Estate Legal Process Call', 'First Time Buyer Legal Guide'],
  aiSupportAfterBooking: [],
  postBookingAutomations: ['lawyer_legal_education'],
  postBookingChatChecklist: [
    'Your main questions about the legal side of buying, selling, or transferring property.',
    'Whether you are early-stage or already under contract.',
    'Any concerns about timelines, documents, or first-time buyer steps.',
    'How you prefer to follow up after the introductory call.',
  ],
};

export const getLawyerActionFlow = (leadGrade) => {
  const tier = mapGradeToTier(leadGrade || 'cold');
  const band = tier === 'hot' ? '(80–100)' : tier === 'warm' ? '(60–79)' : '(0–59)';
  const tierLabel = `${tier.toUpperCase()} LAWYER CLIENT ${band}`;
  const flow = tier === 'hot' ? HOT : tier === 'warm' ? WARM : EARLY;

  return {
    ...flow,
    postBookingAutomations: flow.postBookingAutomations || [],
    postBookingChatChecklist: flow.postBookingChatChecklist || [],
    tier,
    tierLabel,
  };
};
