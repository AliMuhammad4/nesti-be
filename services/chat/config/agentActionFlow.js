const mapGradeToTier = (grade) => {
  if (grade === 'hot') return 'hot';
  if (grade === 'warm') return 'warm';
  return 'early';
};

const BUYER = {
  hot: {
    goal: 'Get them into a showing or strategy call immediately',
    recommendedAppointment: ['Buyer Consultation (15–20 min)', 'Property Showing Tour'],
    prompt:
      "Based on your answers, you're ready to start viewing homes. Choose a time below to schedule your home buying consultation or book a showing.",
    calendlyOptions: ['Buyer Strategy Call', 'Property Showing Tour', 'Virtual Home Tour'],
    aiSupportAfterBooking: [
      'One professional consultation email with property matches, showing itinerary, and tour map',
    ],
    postBookingAutomations: ['property_matches', 'showing_itinerary', 'map_route'],
    postBookingChatChecklist: [
      'Confirm you received your consultation materials email (matches, itinerary, and map in one message) and check spam or promotions folders.',
      'Gather your pre-approval letter or a clear budget range to discuss on the call.',
      'List top neighbourhoods or must-see addresses so your agent can prioritise.',
      'Note parking, pets, or HOA questions you want answered before you tour.',
    ],
  },
  warm: {
    goal: 'Consultation first',
    recommendedAppointment: ['Buyer Strategy Call'],
    prompt:
      "You're getting close to buying. Book a quick strategy session so we can plan your next steps.",
    calendlyOptions: ['Home Buying Consultation', 'Mortgage Planning Call'],
    aiSupportAfterBooking: [
      'One consultation email with budget overview and listing-alert preferences',
    ],
    postBookingAutomations: ['budget_analysis', 'property_alerts'],
    postBookingChatChecklist: [
      'Review the budget and listing-alert sections in your consultation materials email; note anything that has changed since your conversation.',
      'Confirm target areas and price band for listing alerts with your agent on the call.',
      'Prepare questions on timeline, financing, and how offers work in your market.',
      'Share any life changes (job move, lease end) that affect when you need to buy.',
    ],
  },
  early: {
    goal: 'Education call',
    recommendedAppointment: [],
    prompt:
      "Buying a home can feel overwhelming. Book a short call and we'll walk you through the process.",
    calendlyOptions: ['First Time Buyer Consultation', 'Market Overview Session'],
    aiSupportAfterBooking: [],
    postBookingAutomations: [],
    postBookingChatChecklist: [
      'Write down your top questions about how buying works (offer, inspection, closing).',
      'Rough timeline helps — even “still exploring” is useful for your agent to prepare.',
      'Bring any lender letters or rough budget notes you already have.',
      'Think about areas or property types you’re curious about so the call stays focused.',
    ],
  },
};

const SELLER = {
  hot: {
    goal: 'Get the listing appointment booked',
    recommendedAppointment: [],
    prompt:
      'Your home may be ready for the market. Choose a time below for a listing consultation and professional valuation.',
    calendlyOptions: ['Home Valuation Appointment', 'Listing Consultation (in person or virtual)'],
    aiSupportAfterBooking: [
      'Instant home valuation report',
      'Local sales comparables',
      'Seller preparation checklist',
    ],
    postBookingAutomations: ['seller_followup_pack'],
    postBookingChatChecklist: [
      'Gather recent utility bills, tax assessments, and renovation receipts for the valuation discussion.',
      'Walk through the seller prep checklist from your email and note what you can tackle first.',
      'List upgrades you’ve done (kitchen, roof, HVAC) with approximate years.',
      'Think about your ideal listing timeline and any must-have sale conditions.',
    ],
  },
  warm: {
    goal: 'Listing strategy session',
    recommendedAppointment: [],
    prompt: '',
    calendlyOptions: ['Seller Strategy Call', 'Home Value Review'],
    aiSupportAfterBooking: ['Market report', 'Recent neighbourhood sales'],
    postBookingAutomations: ['market_report'],
    postBookingChatChecklist: [
      'Review the market / pipeline snapshot email before your strategy session.',
      'Note comparable sales you’re aware of in your neighbourhood.',
      'List your target list price range (even rough) and what would make you hesitate.',
      'Prepare questions on staging, timing, and how your agent plans to position the home.',
    ],
  },
  early: {
    goal: 'Market education',
    recommendedAppointment: [],
    prompt: '',
    calendlyOptions: ['Market Timing Consultation', 'Future Selling Strategy Call'],
    aiSupportAfterBooking: [],
    postBookingAutomations: [],
    postBookingChatChecklist: [
      'List questions about when to sell vs wait, and what drives timing for you.',
      'Rough notes on your home’s condition and any known fixes help set expectations.',
      'Think about whether you’ll need to buy another home before or after you sell.',
      'Ask how your agent explains market conditions without pressure — you’re still learning.',
    ],
  },
};

/**
 * Investor (buy intent) wording. Overlays the buyer tier so automation keys, tier labels, and scoring stay
 * unchanged; only goals, CTA options, and the visitor checklist speak to investment strategy.
 */
const INVESTOR = {
  hot: {
    goal: 'Get them into an investment strategy call or deal review immediately',
    recommendedAppointment: ['Investment Strategy Call (15–20 min)', 'Investment Property Tour'],
    prompt:
      "Based on your answers, you're ready to review investment properties. Choose a time below to book your investment strategy call or a property tour.",
    calendlyOptions: ['Investment Strategy Call', 'Investment Property Tour', 'Deal Review Call'],
    postBookingChatChecklist: [
      'Confirm you received your consultation materials email and check spam or promotions folders.',
      'Have proof of funds or your financing plan (pre-approval, cash, or lender terms) ready to discuss.',
      'List target markets and your strategy (long-term rental, short-term rental, flip, or multi-unit).',
      'Note your return targets — rent, cash flow, or appreciation — so your agent can screen deals.',
    ],
  },
  warm: {
    goal: 'Investment strategy consultation first',
    recommendedAppointment: ['Investment Strategy Call'],
    prompt:
      "You're getting close to investing. Book a quick strategy session so we can plan markets, budget, and your next steps.",
    calendlyOptions: ['Investment Strategy Consultation', 'Rental Market Review'],
    postBookingChatChecklist: [
      'Review the budget and listing-alert sections in your consultation materials email; note anything that has changed.',
      'Confirm target markets, price band, and property types for investment alerts with your agent.',
      'Prepare questions on expected rents, vacancy, and local rental rules in your target market.',
      'Share how you plan to finance and hold the property (personally or through a company).',
    ],
  },
  early: {
    goal: 'Investor education call',
    recommendedAppointment: [],
    prompt:
      "Investing in real estate starts with a clear plan. Book a short call and we'll walk you through markets and strategy — no pressure.",
    calendlyOptions: ['Investor Discovery Call', 'Investment Market Overview'],
    postBookingChatChecklist: [
      'Write down your investment goal: rental income, appreciation, or both.',
      'Rough capital available for a down payment and reserves — even a range helps.',
      'Markets or property types you are curious about so the call stays focused.',
      'Your timeline — even “still exploring” helps your agent prepare.',
    ],
  },
};

/**
 * @param {string} leadGrade
 * @param {string} intent
 * @param {{ clientType?: string }} [context] investor visitors (buy intent) get investment-strategy wording.
 */
export const getAgentActionFlow = (leadGrade, intent, context = {}) => {
  const tier = mapGradeToTier(leadGrade || 'cold');
  const isBuyer = intent !== 'sell';
  const roleLabel = isBuyer ? 'BUYER' : 'SELLER';
  const band = tier === 'hot' ? '(80–100)' : tier === 'warm' ? '(60–79)' : '(0–59)';
  const tierLabel = `${tier.toUpperCase()} ${roleLabel} ${band}`;

  const byTier = isBuyer ? BUYER : SELLER;
  const base = byTier[tier] || byTier.early;
  const investor = isBuyer && String(context?.clientType || '').toLowerCase() === 'investor';
  const flow = investor ? { ...base, ...(INVESTOR[tier] || INVESTOR.early) } : base;

  return {
    ...flow,
    postBookingAutomations: flow.postBookingAutomations || [],
    postBookingChatChecklist: flow.postBookingChatChecklist || [],
    tier,
    tierLabel,
    role: isBuyer ? 'buy' : 'sell',
  };
};
