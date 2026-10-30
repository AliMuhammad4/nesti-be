export const ASSISTANT_ROLES = ['agent', 'mortgage_broker', 'lawyer'];

const roleAssistantFaqContent = {
  agent: [
    ['How can you help me buy a home?', 'I can learn what you are looking for, discuss the buying process, and help arrange a conversation with the agent.'],
    ['Can you help me sell my home?', 'I can learn about your property and timing, then help connect you with the agent to discuss a selling plan.'],
    ['What areas do you serve?', 'Share the city or area you have in mind and I can help check whether it matches the agent’s service area.'],
    ['Can you help me find a property?', 'Tell me your preferred location, property type, budget range, and timing so the agent can understand what you need.'],
    ['How much is my home worth?', 'A property’s value depends on its details and current market conditions. The agent can discuss an estimate after learning more about the home.'],
    ['Can you help me make an offer?', 'I can collect some context, but offer strategy depends on the property and your circumstances. The agent can discuss appropriate next steps with you.'],
    ['I am a first-time buyer. Where should I start?', 'We can start with your goals, preferred area, budget range, and timeline. The agent can then help you understand the next steps.'],
    ['What are your real estate fees?', 'Fees and services depend on the work involved and the agreement. The agent can explain the applicable details directly.'],
    ['Can I book a consultation?', 'I can help you request a conversation with the agent. Share what you would like to discuss and a suitable time.'],
    ['How long does buying or selling take?', 'Timing varies with the property, market, and your situation. The agent can help outline a realistic timeline once they know more.'],
    ['Do I need mortgage pre-approval before viewing homes?', 'Pre-approval can help clarify a budget, but the right timing depends on your situation. A mortgage professional can advise on financing questions.'],
    ['How will you keep me updated?', 'Tell me your preferred way to be contacted and what you are looking for; the agent can confirm the best way to keep you updated.'],
  ],
  mortgage_broker: [
    ['Can you help me get mortgage pre-approval?', 'I can collect basic details about your plans so the broker can discuss the pre-approval process and information they may need.'],
    ['Can you help me refinance my mortgage?', 'Refinancing depends on your current mortgage and goals. The broker can review your situation and explain possible options.'],
    ['Can you help with a mortgage renewal?', 'Yes, I can collect your renewal timing and goals so the broker can follow up about your options.'],
    ['What mortgage options might suit me?', 'Options depend on your finances, property, and goals. The broker can review those details with you before discussing suitable choices.'],
    ['Can self-employed people apply for a mortgage?', 'Self-employed applications may involve additional income documentation. The broker can explain what may be relevant to your circumstances.'],
    ['How much down payment will I need?', 'The amount depends on factors such as the property price and applicable lending rules. The broker can discuss your specific situation.'],
    ['What are current mortgage rates?', 'Rates can change and depend on the product and borrower qualifications. The broker can confirm current rates and explain the terms available to you.'],
    ['What costs should I plan for when getting a mortgage?', 'Costs vary by transaction and lender. The broker can help identify financing-related costs, and other professionals can clarify legal or property costs.'],
    ['What documents should I prepare?', 'Requirements depend on your application. The broker can provide a tailored checklist after learning about your income, property, and financing goals.'],
    ['How long does mortgage approval take?', 'Timelines vary with the lender and completeness of the application. The broker can give a better estimate after reviewing your situation.'],
    ['Can you help if my credit history is complicated?', 'The broker can discuss your circumstances privately and explain possible next steps. I cannot determine eligibility from a chat alone.'],
    ['Can you guarantee mortgage approval?', 'No. Approval is determined by the lender after reviewing an application. The broker can explain the process but cannot guarantee an outcome.'],
  ],
  lawyer: [
    ['Can you help with a home purchase closing?', 'Yes. I handle purchase closings. I can start with the agreement, the closing timeline, and the jurisdiction.'],
    ['Can you help with a home sale closing?', 'Yes. I handle sale closings. I can start with the agreement, the closing timeline, and the jurisdiction.'],
    ['What does a real estate lawyer do during closing?', 'I review the transaction documents, address title and closing requirements, and coordinate the legal steps. The exact work depends on the transaction and jurisdiction.'],
    ['Can you review my purchase agreement?', 'I can review the purchase agreement once we confirm the matter. You can upload it here when I ask for it.'],
    ['Can you help with a title search?', 'I can discuss a title search for your closing and confirm the scope from the jurisdiction.'],
    ['Can you help with a mortgage refinance?', 'I can help with the legal side of a refinance closing, including the documents and the jurisdiction. I do not take a loan application.'],
    ['What are the legal fees for a real estate transaction?', 'Fees depend on the transaction, the jurisdiction, and the work required. I can explain them once I know which closing this is.'],
    ['How long does a real estate closing take?', 'Timing depends on the documents and the jurisdiction. I can identify the key dates once I know the closing timeline.'],
    ['Do you provide services in my jurisdiction?', 'Share the jurisdiction for the property and I can confirm whether I am authorized to assist there.'],
    ['What documents should I prepare for closing?', 'The documents depend on whether this is a purchase closing, a sale closing, or a refinance closing. I can list them once I know which one.'],
    ['Can I meet with the lawyer remotely?', 'I can confirm whether a remote consultation is available for this matter.'],
    ['Can you give me legal advice in this chat?', 'This chat shares general information and arranges a conversation. I give advice after I understand the matter and we confirm the engagement.'],
  ],
};

export const ROLE_ASSISTANT_FAQS = Object.fromEntries(
  Object.entries(roleAssistantFaqContent).map(([role, entries]) => [
    role,
    entries.map(([question, answer], index) => ({
      id: `${role}-assistant-faq-${String(index + 1).padStart(2, '0')}`,
      question,
      answer,
      is_default: true,
      approved: true,
      source: 'manual',
    })),
  ]),
);

// Storage ids stay stable (they key the voice maps in replyStyle and the prompt blocks);
// labels and descriptors follow the five client-facing personality cards.
export const PERSONALITIES = [
  ['luxury', 'Luxury Concierge', 'Sophisticated, polished, exclusive.'],
  ['friendly', 'Friendly Advisor', 'Warm, approachable, conversational.'],
  ['polished', 'Trusted Expert', 'Professional, knowledgeable, reassuring.'],
  ['persuasive', 'Results-Oriented', 'Confident, direct, efficient.'],
  ['consultative', 'Investor Specialist', 'Analytical, strategic, detail-focused.'],
];

const LEGACY_PERSONALITY_IDS = {
  caring: 'friendly',
  luxury_concierge: 'luxury',
  friendly_advisor: 'friendly',
  trusted_expert: 'polished',
  results_oriented: 'persuasive',
  investor_specialist: 'consultative',
};

export function legacyPersonalityId(id) {
  const key = String(id || '').trim();
  return LEGACY_PERSONALITY_IDS[key] || key;
}

export const CLIENT_TYPES = [
  ['buyer', 'Buyer'],
  ['seller', 'Seller'],
  ['investor', 'Investor'],
];

export const RESPONSE_LENGTHS = [
  ['short', 'Brief', 'One short sentence.'],
  ['balanced', 'Balanced', 'One or two short sentences.'],
  ['detailed', 'Detailed', 'Two or three short sentences with one helpful fact.'],
];

export const DEFAULT_BRAND_COLORS = { primary: '#1F6F4A', accent: '#2BB673' };

const BUDGET_OPTIONS = ['Under $400k', '$400k–$700k', '$700k–$1M', '$1M+'];
const TIMELINE_OPTIONS = ['As soon as possible', '1–3 months', '3–6 months', '6–12 months', 'Just exploring'];
const PROPERTY_TYPE_OPTIONS = ['Detached house', 'Townhouse', 'Condo', 'Multi-family', 'Other'];
const DOWN_PAYMENT_OPTIONS = ['20% or more', '10–19%', '5–9%', 'Under 5%', 'Not yet'];
const INCOME_OPTIONS = ['Under $70k', '$70k–$100k', '$100k–$150k', '$150k–$200k', '$200k+'];
const CLOSING_OPTIONS = ['Within 30 days', '30–60 days', '60–90 days', 'Not set yet'];

const template = (ctaLabel, questions) => ({
  cta_label: ctaLabel,
  questions: questions.map(([id, label, options = []]) => ({ id, label, options })),
});

export const QUALIFICATION_TEMPLATES = {
  agent: {
    buyer: template('Book a Buyer Consultation', [
      ['location', 'Which city or neighbourhood are you interested in?'],
      ['budget', 'What is your budget range?', BUDGET_OPTIONS],
      ['timeline', 'When are you hoping to buy?', TIMELINE_OPTIONS],
      ['property_type', 'What type of property are you looking for?', PROPERTY_TYPE_OPTIONS],
      ['preapproval', 'Are you pre-approved for a mortgage?', ['Yes', 'In progress', 'Not yet', 'Paying cash']],
    ]),
    seller: template('Request a Property Evaluation', [
      ['location', 'Where is your property located?'],
      ['property_type', 'What type of property are you selling?', PROPERTY_TYPE_OPTIONS],
      ['timeline', 'When are you planning to sell?', TIMELINE_OPTIONS],
      ['expected_price', 'What is your estimated price range?', BUDGET_OPTIONS],
      ['buying_another', 'Are you also buying another property?', ['Yes', 'No', 'Not sure yet']],
    ]),
    investor: template('Book an Investment Consultation', [
      ['investment_type', 'What type of investment are you interested in?', ['Rental property', 'Fix and flip', 'Pre-construction', 'Multi-unit', 'Commercial']],
      ['location', 'Which markets are you considering?'],
      ['budget', 'What is your investment budget?', BUDGET_OPTIONS],
      ['investment_goal', 'Are you focused on rental income or appreciation?', ['Rental income', 'Appreciation', 'Both']],
      ['timeline', 'When are you planning to invest?', TIMELINE_OPTIONS],
    ]),
  },
  mortgage_broker: {
    buyer: template('Book a Mortgage Consultation', [
      ['purpose', 'Is this your first home, your next home, or an investment property?', ['First home', 'Next home', 'Investment property']],
      ['property_value', 'What price range are you considering?', BUDGET_OPTIONS],
      ['down_payment', 'Do you have a down payment saved?', DOWN_PAYMENT_OPTIONS],
      ['household_income', 'What is your approximate household income?', INCOME_OPTIONS],
      ['timeline', 'When are you planning to buy?', TIMELINE_OPTIONS],
    ]),
    seller: template('Explore My Mortgage Options', [
      ['purpose', 'Are you selling and buying, renewing, or refinancing?', ['Selling and buying', 'Renewing', 'Refinancing']],
      ['property_value', 'What is your current property value?', BUDGET_OPTIONS],
      ['mortgage_balance', 'Do you currently have a mortgage on the property?', ['Yes', 'No']],
      ['term_end', 'When does your current mortgage term end?', ['Within 3 months', '3–6 months', '6–12 months', 'More than a year', 'Not sure']],
      ['timeline', 'When would you like to review your options?', TIMELINE_OPTIONS],
    ]),
    investor: template('Book an Investment Financing Consultation', [
      ['investment_type', 'What type of investment property are you considering?', ['Rental property', 'Multi-unit', 'Pre-construction', 'Commercial', 'Vacation rental']],
      ['property_value', 'What is the purchase price range?', BUDGET_OPTIONS],
      ['down_payment', 'What down payment do you have available?', DOWN_PAYMENT_OPTIONS],
      ['owns_investments', 'Do you own other investment properties?', ['Yes', 'No']],
      ['timeline', 'When do you need financing?', TIMELINE_OPTIONS],
    ]),
  },
  lawyer: {
    buyer: template('Schedule a Legal Consultation', [
      ['property_type', 'What type of property are you purchasing?', PROPERTY_TYPE_OPTIONS],
      ['location', 'Where is the property located?'],
      ['transaction_type', 'Have you signed an accepted agreement of purchase and sale?', ['Yes', 'Not yet', 'In negotiation']],
      ['closing_date', 'What is your expected closing date?', CLOSING_OPTIONS],
      ['legal_service', 'What legal services do you need?', ['Purchase closing', 'Agreement review', 'Title search', 'Not sure yet']],
    ]),
    seller: template('Schedule a Closing Consultation', [
      ['property_type', 'What type of property are you selling?', PROPERTY_TYPE_OPTIONS],
      ['location', 'Where is the property located?'],
      ['transaction_type', 'Has the sale agreement been signed?', ['Yes', 'Not yet', 'In negotiation']],
      ['closing_date', 'What is your expected closing date?', CLOSING_OPTIONS],
      ['legal_service', 'What legal assistance do you need?', ['Sale closing', 'Agreement review', 'Mortgage discharge', 'Not sure yet']],
    ]),
    investor: template('Book an Investment Legal Consultation', [
      ['legal_service', 'Are you purchasing, selling, or refinancing?', ['Purchasing', 'Selling', 'Refinancing']],
      ['property_type', 'Is the property residential or commercial?', ['Residential', 'Commercial', 'Mixed use']],
      ['location', 'Where is the property located?'],
      ['via_company', 'Are you purchasing personally or through a company?', ['Personally', 'Through a company', 'Not sure yet']],
      ['closing_date', 'When is the transaction date?', CLOSING_OPTIONS],
    ]),
  },
};

/** Question ids the public intake form already collects for this role. Chat skips them when filled. */
export const INTAKE_QUESTION_IDS = {
  agent: ['intent', 'location', 'budget', 'timeline', 'property_type', 'preapproval', 'expected_price'],
  mortgage_broker: ['purpose', 'location', 'property_value', 'timeline', 'preapproval', 'down_payment', 'household_income'],
  lawyer: ['legal_service', 'location', 'transaction_type', 'closing_date'],
};

export function templateQuestionLabel(role, id) {
  const types = QUALIFICATION_TEMPLATES[role] || {};
  for (const type of Object.values(types)) {
    const hit = type.questions.find((question) => question.id === id);
    if (hit) return hit.label;
  }
  return '';
}

export const COMMUNICATION_STYLES = [
  ['quick', 'Quick and direct', 'Short, concise responses.'],
  ['conversational', 'Friendly and conversational', 'Natural, approachable interactions.'],
  ['educational', 'Educational (fact then question)', 'Two short sentences: one plain fact, then one question.'],
  ['consultative', 'Consultative (observation then question)', 'Two short sentences: one observation, then one question.'],
];

export const FORMALITIES = ['formal', 'professional', 'casual'];

export const LANGUAGES = [
  ['english', 'English'],
  ['french', 'French'],
  ['spanish', 'Spanish'],
  ['hindi', 'Hindi'],
  ['tamil', 'Tamil'],
  ['punjabi', 'Punjabi'],
  ['arabic', 'Arabic'],
  ['other', 'Other supported language'],
];

export const VOICE_LANGUAGES = ['english'];

export const DIFFERENTIATORS = [
  ['experience', 'Years of professional experience'],
  ['personal_service', 'Personalized one-on-one service'],
  ['fast_response', 'Fast response times'],
  ['multilingual', 'Multilingual support'],
  ['market_knowledge', 'Specialized market knowledge'],
  ['first_time', 'First-time homebuyer expertise'],
  ['luxury', 'Luxury clientele'],
  ['competitive_fees', 'Competitive service fees'],
  ['other', 'Other'],
];

export const ROLE_DIFFERENTIATORS = {
  agent: DIFFERENTIATORS,
  mortgage_broker: DIFFERENTIATORS,
  lawyer: [
    ['experience', 'Years of legal experience'],
    ['personal_service', 'Direct lawyer attention'],
    ['fast_response', 'Responsive closing support'],
    ['multilingual', 'Multilingual support'],
    ['market_knowledge', 'Jurisdiction closing expertise'],
    ['first_time', 'First-time buyer closings'],
    ['luxury', 'Complex and high-value closings'],
    ['competitive_fees', 'Clear closing fee structure'],
    ['other', 'Other'],
  ],
};

export const NEXT_ACTIONS = [
  ['schedule', 'Schedule an appointment'],
  ['collect_contact', 'Collect contact information'],
  ['notify', 'Send an instant lead notification'],
  ['save_lead', 'Create or update the lead in Nesti CRM'],
  ['follow_up', 'Send an approved follow-up'],
];

export const SERVICES = {
  agent: [
    ['buying', 'Buying a home'],
    ['selling', 'Selling a home'],
    ['first_time', 'First-time homebuyers'],
    ['luxury', 'Luxury real estate'],
    ['investment', 'Investment properties'],
    ['commercial', 'Commercial real estate'],
    ['rentals', 'Rentals and leasing'],
    ['relocation', 'Relocation services'],
    ['valuation', 'Property valuations'],
  ],
  mortgage_broker: [
    ['first_time', 'First-time homebuyer mortgages'],
    ['preapproval', 'Mortgage pre-approvals'],
    ['renewal', 'Mortgage renewals'],
    ['refinance', 'Refinancing'],
    ['investment', 'Investment property financing'],
    ['commercial', 'Commercial mortgages'],
    ['debt', 'Debt consolidation'],
    ['self_employed', 'Self-employed mortgages'],
    ['credit', 'Credit improvement guidance'],
  ],
  lawyer: [
    ['purchase_closing', 'Residential purchase closings'],
    ['sale_closing', 'Residential sale closings'],
    ['title_search', 'Title searches'],
    ['title_insurance', 'Title insurance'],
    ['refinance', 'Mortgage refinancing'],
    ['commercial', 'Commercial real estate transactions'],
    ['contract_review', 'Contract reviews'],
    ['ownership_transfer', 'Property ownership transfers'],
    ['disputes', 'Real estate disputes'],
  ],
};

export const QUALIFICATION = {
  agent: [
    ['intent', 'Are you buying, selling, or exploring?'],
    ['location', 'What location are you interested in?'],
    ['budget', 'What is your approximate budget?'],
    ['timeline', 'What is your preferred timeline?'],
    ['property_type', 'What type of property are you interested in?'],
    ['preapproval', 'Have you obtained mortgage pre-approval?'],
  ],
  mortgage_broker: [
    ['purpose', 'Are you purchasing, refinancing, or renewing?'],
    ['location', 'Where is the property located?'],
    ['property_value', 'What is the approximate property value?'],
    ['amount', 'What financing amount are you considering?'],
    ['timeline', 'What is your preferred financing timeline?'],
    ['preapproval', 'Have you obtained a mortgage pre-approval?'],
  ],
  lawyer: [
    ['legal_service', 'Is this a purchase closing, a sale closing, or a refinance closing?'],
    ['location', 'Which jurisdiction is the property in?'],
    ['transaction_type', 'Has the agreement been signed?'],
    ['transaction_value', 'Are there any title or document questions?'],
    ['closing_date', 'What is the closing timeline?'],
    ['urgency', 'Who are the parties to the closing?'],
  ],
};

export const DOCUMENT_REQUESTS = {
  agent: [
    ['preapproval_letter', 'Pre-approval letter'],
    ['home_photos', 'Photos of the home'],
    ['listing_sheet', 'Listing or MLS sheet'],
  ],
  mortgage_broker: [
    ['pay_stubs', 'Recent pay stubs'],
    ['notice_of_assessment', 'Notice of assessment or T4'],
    ['mortgage_statement', 'Current mortgage statement'],
    ['preapproval_letter', 'Pre-approval letter'],
    ['photo_id', 'Photo ID'],
  ],
  lawyer: [
    ['purchase_agreement', 'Purchase or sale agreement'],
    ['title_deed', 'Title or deed'],
    ['mortgage_commitment', 'Mortgage commitment'],
    ['photo_id', 'Photo ID'],
    ['condo_status', 'Condo status certificate'],
  ],
};

export function idsOf(pairs) {
  return pairs.map(([id]) => id);
}

export function labelOf(pairs, id) {
  return pairs.find(([value]) => value === id)?.[1] || '';
}
