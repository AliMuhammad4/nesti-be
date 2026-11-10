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

/** Market-specific income-document wording for checklists (Canada NOA/T4 vs U.S. W-2/1099/tax returns). */
const TAX_DOCS = {
  CA: 'Notices of Assessment (NOA) and T4 slips (T1 Generals if self-employed)',
  US: 'W-2s, 1099s, or recent tax returns',
  '': 'T4s / NOA (Canada) or W-2s / tax returns (U.S.)',
};

function investorFlow(tier, market) {
  const tax = TAX_DOCS[market] || TAX_DOCS[''];
  const rentalDocs = market === 'US' ? 'lease agreements or a rent roll' : 'lease agreements and property tax bills';
  const entityDocs = market === 'US' ? 'LLC or corporation documents' : market === 'CA' ? 'corporate documents' : 'company documents';
  const programLine = market === 'US'
    ? 'Which programs fit: conventional investment-property loan, DSCR, portfolio, or bridge / hard money.'
    : market === 'CA'
      ? 'Which lenders fit: bank / A lender rental mortgage vs B or private lender, and how rental income is counted.'
      : 'Which investment-property financing options fit your market.';
  if (tier === 'hot') {
    return {
      goal: 'Investment property financing consultation',
      prompt: "Based on your details, you're ready to map out financing for this investment property. Book a call to review the right lending options.",
      calendlyOptions: ['Investment Property Financing Consultation', 'Rental Property Pre-Approval Call'],
      aiSupportAfterBooking: [`Document checklist after booking: ${tax}, bank statements for down payment and reserves, ${rentalDocs}, government-issued ID`],
      postBookingChatChecklist: [
        `Have ${tax} ready for income verification (DSCR or cash buyers may need less).`,
        'Bank statements showing the down payment and reserves for this purchase.',
        `For properties you already own: mortgage statements and ${rentalDocs}.`,
        `If you are borrowing through a company: ${entityDocs}.`,
      ],
    };
  }
  if (tier === 'warm') {
    return {
      goal: 'Investment financing planning call',
      prompt: "You're in a good position to plan your investment financing. Book a session to compare lending options, down payment, and cash flow.",
      calendlyOptions: ['Investment Financing Planning Session', 'Rental Property Strategy Call'],
      aiSupportAfterBooking: [
        'How investment-property down payments and rental income are treated by lenders (concepts only, no approval)',
        programLine,
      ],
      postBookingChatChecklist: [
        'Target purchase price, expected rent, and your strategy (long-term rental, short-term rental, flip, or BRRRR).',
        'Down payment source and the reserves you plan to keep after closing.',
        'Properties you already own and their current mortgages.',
        programLine,
      ],
    };
  }
  return {
    goal: 'Investment financing readiness guidance',
    prompt: "Let's start with a short call to understand your investment goals and map a financing path — no pressure, just clarity.",
    calendlyOptions: ['Investment Financing Discovery Call', 'Investor Readiness Session'],
    aiSupportAfterBooking: [],
    postBookingChatChecklist: [
      'Your investment goal and strategy, even if it is still early.',
      'Rough capital available for a down payment and reserves.',
      'Whether you plan to borrow personally or through a company.',
      'Timeline — even “still exploring” helps your broker meet you where you are.',
    ],
  };
}

/**
 * @param {string} leadGrade
 * @param {{ clientType?: string, market?: string }} [context] investor leads get investment-financing goals and
 *   market-specific (Canada / U.S.) document wording; others keep the homebuyer flow unchanged.
 */
export const getMortgageBrokerActionFlow = (leadGrade, context = {}) => {
  const tier = mapGradeToTier(leadGrade || 'cold');
  const band = tier === 'hot' ? '(80–100)' : tier === 'warm' ? '(60–79)' : '(0–59)';
  const tierLabel = `${tier.toUpperCase()} MORTGAGE BROKER ${band}`;
  const base = tier === 'hot' ? HOT : tier === 'warm' ? WARM : EARLY;
  const investor = String(context?.clientType || '').toLowerCase() === 'investor';
  const flow = investor
    ? { ...base, ...investorFlow(tier, String(context?.market || '').toUpperCase()) }
    : base;

  return {
    ...flow,
    postBookingAutomations: flow.postBookingAutomations || [],
    postBookingChatChecklist: flow.postBookingChatChecklist || [],
    tier,
    tierLabel,
  };
};
