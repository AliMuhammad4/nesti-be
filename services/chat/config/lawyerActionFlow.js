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

/** Purchase agreement wording by market: Canada uses the APS, the U.S. a purchase agreement / contract. */
const AGREEMENT_NAME = {
  CA: 'agreement of purchase and sale',
  US: 'purchase agreement (purchase contract)',
  '': 'purchase agreement (agreement of purchase and sale in Canada)',
};

function marketFlow(tier, market) {
  // Canada and unknown markets keep the original APS wording.
  if (market !== 'US') return {};
  const agreement = AGREEMENT_NAME.US;
  if (tier === 'hot') {
    return {
      aiSupportAfterBooking: [
        'Closing checklist (conditions, title, lender instructions, adjustments)',
        `Document preparation guide (IDs, ${agreement}, lender correspondence)`,
      ],
      postBookingChatChecklist: [
        'Confirm your closing date and any outstanding conditions on your agreement.',
        `Gather government-issued ID and a complete copy of your ${agreement}.`,
        'Have lender instructions and any mortgage documents your lawyer requested.',
        'Note questions about title, closing costs, and adjustments before your appointment.',
      ],
    };
  }
  return {};
}

function investorFlow(tier, market) {
  const agreement = AGREEMENT_NAME[market] ?? AGREEMENT_NAME[''];
  const entity = market === 'US' ? 'LLC or corporation documents' : market === 'CA' ? 'corporate documents' : 'company documents';
  if (tier === 'hot') {
    return {
      goal: 'Investment closing consultation',
      prompt:
        "You're close to completing this investment transaction. Book a closing consultation with a real estate lawyer to prepare the documents.",
      calendlyOptions: ['Investment Property Closing Consultation', 'Purchase Agreement Review'],
      aiSupportAfterBooking: [
        'Closing checklist (conditions, title and how it is held, lender instructions, adjustments, existing leases)',
        `Document preparation guide (IDs, ${agreement}, ${entity} if buying through a company, lender correspondence)`,
      ],
      postBookingChatChecklist: [
        'Confirm your closing date and any outstanding conditions on your agreement.',
        `Gather government-issued ID and a complete copy of your ${agreement}.`,
        `If you are buying through a company: ${entity} and who signs for it.`,
        'For a tenanted property: current leases, rent roll, and deposits to adjust on closing.',
      ],
    };
  }
  if (tier === 'warm') {
    return {
      goal: 'Investment legal preparation',
      prompt:
        "You're making solid progress. Book a legal consultation to plan how the investment property is purchased and held, and the steps to closing.",
      calendlyOptions: ['Investment Property Legal Consultation', 'Title and Ownership Structure Review'],
      aiSupportAfterBooking: [
        'What legal review typically covers for an investment purchase (not legal advice)',
        'How ownership (personal or company) and existing tenancies fit with your closing timeline',
      ],
      postBookingChatChecklist: [
        'Rough timeline from offer to closing and where legal fits in.',
        'Whether you will hold the property personally or through a company.',
        'Any existing tenants, leases, or rental rules you have questions about.',
        'Whether you are working with a realtor and lender so your lawyer can coordinate.',
      ],
    };
  }
  return {
    goal: 'Investment legal education',
    prompt:
      "Let's start with a short call to understand your investment plans and explain how a real estate lawyer helps — no pressure, just clarity.",
    calendlyOptions: ['Real Estate Legal Process Call', 'Investor Legal Guide Call'],
    aiSupportAfterBooking: [],
    postBookingChatChecklist: [
      'Your main questions about the legal side of buying, selling, or refinancing an investment property.',
      'Whether you are early-stage or already under contract.',
      'Whether you plan to buy personally or through a company.',
      'How you prefer to follow up after the introductory call.',
    ],
  };
}

/**
 * @param {string} leadGrade
 * @param {{ clientType?: string, market?: string }} [context] investor clients get investment-closing wording;
 *   the market (CA / US) picks agreement wording. No context keeps the original homebuyer flow.
 */
export const getLawyerActionFlow = (leadGrade, context = {}) => {
  const tier = mapGradeToTier(leadGrade || 'cold');
  const band = tier === 'hot' ? '(80–100)' : tier === 'warm' ? '(60–79)' : '(0–59)';
  const tierLabel = `${tier.toUpperCase()} LAWYER CLIENT ${band}`;
  const base = tier === 'hot' ? HOT : tier === 'warm' ? WARM : EARLY;
  const market = String(context?.market || '').toUpperCase();
  const investor = String(context?.clientType || '').toLowerCase() === 'investor';
  const flow = investor
    ? { ...base, ...investorFlow(tier, market) }
    : { ...base, ...marketFlow(tier, market) };

  return {
    ...flow,
    postBookingAutomations: flow.postBookingAutomations || [],
    postBookingChatChecklist: flow.postBookingChatChecklist || [],
    tier,
    tierLabel,
  };
};
