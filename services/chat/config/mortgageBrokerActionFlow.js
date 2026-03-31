/**
 * Mortgage broker — appointment / Calendly guidance by lead tier.
 * Score bands (mortgageBrokerScoring.js): hot 80–100, warm 60–79, cold 0–59 (tier "early").
 */

const mapGradeToTier = (grade) => {
  if (grade === 'hot') return 'hot';
  if (grade === 'warm') return 'warm';
  return 'early';
};

const HOT = {
  goal: 'Mortgage pre-approval appointment',
  recommendedAppointment: [],
  prompt:
    "Based on your information, you're ready to get pre-approved. Book a quick call with a mortgage expert to start the process.",
  calendlyOptions: ['Mortgage Pre-Approval Consultation', 'Affordability Review Call'],
  aiSupportAfterBooking: [
    'Document checklist after booking: pay stubs, bank statements, government-issued ID, T4s (or relevant tax documents)',
  ],
  postBookingAutomations: ['mortgage_preapproval_docs'],
  postBookingChatChecklist: [
    'Gather recent pay stubs (typically last 30–60 days) for income verification.',
    'Have bank statements ready for accounts you will use for down payment and closing.',
    'Keep a valid government-issued ID accessible for identity verification.',
    'Locate T4s or other tax documents your broker may request for the pre-approval file.',
  ],
};

const WARM = {
  goal: 'Mortgage planning call',
  recommendedAppointment: [],
  prompt:
    "You're in a strong position to plan your mortgage. Book a session to review rates, budget, and next steps with your broker.",
  calendlyOptions: ['Mortgage Planning Session', 'Rate & Budget Consultation'],
  aiSupportAfterBooking: [
    'Mortgage affordability concepts (payment vs price, stress-test awareness — not formal approval)',
    'Down payment planning (savings timeline, sources, and what to discuss on the call)',
  ],
  postBookingAutomations: ['mortgage_planning_summary'],
  postBookingChatChecklist: [
    'Rough monthly budget and major fixed costs — even estimates help frame the planning call.',
    'Questions about rate types (fixed vs variable) and what you want clarified before you lock anything.',
    'Target purchase price or range, if you have one, plus any life changes affecting timing.',
    'Note any credit or employment changes since you last spoke so your broker can advise accurately.',
  ],
};

const EARLY = {
  goal: 'Financial readiness guidance',
  recommendedAppointment: [],
  prompt:
    "Let's start with a short call to understand your goals and build a path toward homeownership — no pressure, just clarity.",
  calendlyOptions: ['Credit Improvement Consultation', 'Homeownership Planning Session'],
  aiSupportAfterBooking: [],
  postBookingAutomations: ['mortgage_readiness_guide'],
  postBookingChatChecklist: [
    'Write down your top questions about credit, savings, or how mortgage approval works.',
    'Rough notes on income stability and any concerns you want to address early.',
    'Whether you are open to steps to strengthen your file before you apply.',
    'Timeline — even “still exploring” helps your broker meet you where you are.',
  ],
};

export const getMortgageBrokerActionFlow = (leadGrade) => {
  const tier = mapGradeToTier(leadGrade || 'cold');
  const band = tier === 'hot' ? '(80–100)' : tier === 'warm' ? '(60–79)' : '(0–59)';
  const tierLabel = `${tier.toUpperCase()} MORTGAGE BROKER ${band}`;
  const flow = tier === 'hot' ? HOT : tier === 'warm' ? WARM : EARLY;

  return {
    ...flow,
    postBookingAutomations: flow.postBookingAutomations || [],
    postBookingChatChecklist: flow.postBookingChatChecklist || [],
    tier,
    tierLabel,
  };
};
