const DIMENSIONS = {
  client_type: {
    title: 'Client type',
    strength: 'Their situation matches the buyer or seller segments you prioritize.',
    gap: 'Their profile sits outside your usual ideal-client segments.',
  },
  price_range: {
    title: 'Price range',
    strength: 'Budget aligns with the deal sizes you want to work.',
    gap: 'Budget may be outside your preferred range—confirm before investing time.',
  },
  property_type: {
    title: 'Property type',
    strength: 'Property type fits what you normally list or show.',
    gap: 'Property type may differ from your core focus.',
  },
  service_area: {
    title: 'Service area',
    strength: 'Location falls in your primary markets.',
    gap: 'Location may be outside your core service area.',
  },
  timeline: {
    title: 'Timeline',
    strength: 'Their timing lines up with how you like to work deals.',
    gap: 'Timeline may be longer or looser than your sweet spot.',
  },
  loan_type: {
    title: 'Loan / borrower type',
    strength: 'Borrower profile matches the loan products you specialize in.',
    gap: 'Borrower type may sit outside your core mortgage focus.',
  },
  credit_range: {
    title: 'Credit profile',
    strength: 'Credit band matches what you typically approve or place.',
    gap: 'Credit profile may need extra structuring or a different lender path.',
  },
  income: {
    title: 'Income',
    strength: 'Income level fits your usual qualifying borrowers.',
    gap: 'Income documentation or level may need clarification.',
  },
  loan_size: {
    title: 'Loan size',
    strength: 'Loan size is in the range you prefer to originate.',
    gap: 'Loan size may be outside your target range.',
  },
  transaction_type: {
    title: 'Matter type',
    strength: 'Transaction type matches the legal work you focus on.',
    gap: 'Matter type may differ from your primary practice mix.',
  },
  property_value: {
    title: 'Property value',
    strength: 'Deal size aligns with the matters you typically handle.',
    gap: 'Property value band may sit outside your preferred range.',
  },
};

const TIER_HEADLINE = {
  perfect_match: 'Strong fit with your ideal client profile',
  good_match: 'Solid fit with a few areas to qualify further',
  low_match: 'Limited alignment with your current ICP—still worth a quick triage',
};

export function icpTierHeadline(tier) {
  return TIER_HEADLINE[tier] || 'ICP alignment';
}

export function icpFactorNarrative(dimension, matched) {
  const d = DIMENSIONS[dimension];
  if (!d) {
    const title = String(dimension || 'factor').replace(/_/g, ' ');
    return {
      dimension,
      title,
      detail: matched ? 'Matches one of your configured ICP factors.' : 'Does not match this ICP factor.',
    };
  }
  return {
    dimension,
    title: d.title,
    detail: matched ? d.strength : d.gap,
  };
}
