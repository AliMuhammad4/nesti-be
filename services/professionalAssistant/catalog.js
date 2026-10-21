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
    ['Can you help with a home purchase closing?', 'I can collect the property location and expected closing date so the lawyer can confirm whether they can assist and explain the process.'],
    ['Can you help with a home sale closing?', 'Share the property location and expected closing date; the lawyer can review the details and confirm the next steps.'],
    ['What does a real estate lawyer do during closing?', 'A lawyer may review transaction documents, address title and closing requirements, and coordinate legal steps. The exact work depends on the transaction and jurisdiction.'],
    ['Can you review my purchase agreement?', 'The lawyer can confirm whether they can review the agreement and what documents are needed. Please do not share confidential documents in this chat.'],
    ['Can you help with a title search?', 'The lawyer can discuss title-search services for your transaction and confirm the scope based on the property and its jurisdiction.'],
    ['Can you help with a mortgage refinance?', 'The lawyer can confirm whether they assist with refinance transactions and what information is needed for an initial discussion.'],
    ['What are the legal fees for a real estate transaction?', 'Fees depend on the transaction, location, and work required. The lawyer can provide details after reviewing the relevant information.'],
    ['How long does a real estate closing take?', 'Timing depends on the transaction, documents, and jurisdiction. The lawyer can help identify key dates once they know more about your file.'],
    ['Do you provide services in my jurisdiction?', 'Tell me where the property is located and I can help the lawyer confirm whether they are authorized and available to assist there.'],
    ['What documents should I prepare for closing?', 'Documents vary by transaction and jurisdiction. The lawyer can provide a tailored list after learning whether you are buying, selling, or refinancing.'],
    ['Can I meet with the lawyer remotely?', 'Share your preference and the lawyer can confirm whether a remote consultation is available for your matter.'],
    ['Can you give me legal advice in this chat?', 'This chat is for general information and arranging contact. The lawyer can advise you after understanding your matter and confirming the appropriate engagement.'],
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

export const PERSONALITIES = [
  ['friendly', 'Friendly and approachable', 'Warm, welcoming, and conversational.'],
  ['polished', 'Professional and polished', 'Confident, articulate, and business-focused.'],
  ['luxury', 'Luxury and sophisticated', 'Elegant, refined, and exclusive.'],
  ['persuasive', 'Confident and persuasive', 'Proactive, enthusiastic, and focused on helping clients take the next step.'],
  ['caring', 'Caring and supportive', 'Patient, reassuring, and empathetic.'],
  ['consultative', 'Thoughtful and consultative', 'Asks before recommending a next step.'],
];

export const COMMUNICATION_STYLES = [
  ['quick', 'Quick and direct', 'Short, concise responses.'],
  ['conversational', 'Friendly and conversational', 'Natural, approachable interactions.'],
  ['educational', 'Detailed and educational', 'Comprehensive explanations and informative responses.'],
  ['consultative', 'Consultative and persuasive', 'Thoughtful questions that guide interested prospects toward consultations.'],
];

export const FORMALITIES = ['formal', 'professional', 'casual'];

export const LANGUAGES = [
  ['english', 'English'],
  ['french', 'French'],
  ['spanish', 'Spanish'],
  ['mandarin', 'Mandarin'],
  ['cantonese', 'Cantonese'],
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

export const NEXT_ACTIONS = [
  ['schedule', 'Schedule an appointment'],
  ['collect_contact', 'Collect contact information'],
  ['notify', 'Send an instant lead notification'],
  ['callback', 'Offer a callback'],
  ['transfer_call', 'Transfer an eligible voice call'],
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
    ['legal_service', 'What legal service do you require?'],
    ['location', 'Where is the property located?'],
    ['transaction_type', 'Is this a purchase, sale, refinance, or another transaction?'],
    ['transaction_value', 'What is the approximate transaction value?'],
    ['closing_date', 'What is your expected closing date?'],
    ['urgency', 'How urgent is your request?'],
  ],
};

export function idsOf(pairs) {
  return pairs.map(([id]) => id);
}

export function labelOf(pairs, id) {
  return pairs.find(([value]) => value === id)?.[1] || '';
}
