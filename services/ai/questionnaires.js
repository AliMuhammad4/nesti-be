export const QUESTIONNAIRES = {
  mortgage_broker: {
    type: 'mortgage_broker',
    title: 'NESTI Mortgage Broker Lead Qualification',
    total_score: 100,
    questions: [
      { id: 'mortgage_timeline', field: 'mortgage_timeline', question: 'When do you plan to apply for a mortgage?', type: 'select', max_points: 20, options: [{ value: 'immediately', label: 'Immediately', points: 20 }, { value: '1_2_months', label: 'Within 1–2 months', points: 18 }, { value: '3_6_months', label: '3–6 months', points: 10 }, { value: '6_12_months', label: '6–12 months', points: 5 }, { value: 'just_researching', label: 'Just researching', points: 0 }] },
      { id: 'pre_approval_status', field: 'pre_approval_status', question: 'Have you already been pre-approved?', type: 'select', max_points: 15, options: [{ value: 'need_now', label: 'Need pre-approval now', points: 15 }, { value: 'expired', label: 'Pre-approval expired', points: 12 }, { value: 'in_progress', label: 'Pre-approval in progress', points: 10 }, { value: 'already_approved', label: 'Already approved', points: 5 }, { value: 'just_researching', label: 'Just researching', points: 0 }] },
      { id: 'credit_score_range', field: 'credit_score_range', question: 'What is your approximate credit score?', type: 'select', max_points: 15, options: [{ value: '750_plus', label: '750+', points: 15 }, { value: '700_749', label: '700–749', points: 12 }, { value: '650_699', label: '650–699', points: 8 }, { value: '600_649', label: '600–649', points: 4 }, { value: 'under_600', label: 'Under 600', points: 1 }] },
      { id: 'employment_status', field: 'employment_status', question: 'What is your employment status?', type: 'select', max_points: 10, options: [{ value: 'full_time', label: 'Full-time employed', points: 10 }, { value: 'self_employed', label: 'Self-employed', points: 8 }, { value: 'contract', label: 'Contract worker', points: 6 }, { value: 'new_job', label: 'New job (<1 year)', points: 4 }, { value: 'unemployed', label: 'Unemployed', points: 0 }] },
      { id: 'household_income', field: 'household_income', question: 'What is your approximate household income?', type: 'select', max_points: 10, options: [{ value: '200k_plus', label: '$200k+', points: 10 }, { value: '150k_200k', label: '$150k–200k', points: 8 }, { value: '100k_150k', label: '$100k–150k', points: 6 }, { value: '70k_100k', label: '$70k–100k', points: 4 }, { value: 'under_70k', label: 'Under $70k', points: 1 }] },
      { id: 'down_payment_readiness', field: 'down_payment_readiness', question: 'How much down payment do you have available?', type: 'select', max_points: 15, options: [{ value: '20_plus', label: '20%+', points: 15 }, { value: '10_19', label: '10–19%', points: 12 }, { value: '5_9', label: '5–9%', points: 8 }, { value: 'under_5', label: 'Under 5%', points: 3 }, { value: 'no_savings', label: 'No savings yet', points: 0 }] },
      { id: 'property_budget', field: 'property_budget', question: 'What price range are you considering?', type: 'select', max_points: 5, options: [{ value: 'clearly_defined', label: 'Clearly defined', points: 5 }, { value: 'approximate', label: 'Approximate range', points: 3 }, { value: 'not_sure', label: 'Not sure yet', points: 0 }] },
      { id: 'purchase_purpose', field: 'purchase_purpose', question: 'What type of purchase is this?', type: 'select', max_points: 5, options: [{ value: 'primary_residence', label: 'Primary residence', points: 5 }, { value: 'investment', label: 'Investment property', points: 5 }, { value: 'vacation_home', label: 'Vacation home', points: 3 }] },
      { id: 'urgency_signal', field: 'urgency_signal', question: 'If you were approved tomorrow, would you start house hunting immediately?', type: 'select', max_points: 5, options: [{ value: 'yes', label: 'Yes', points: 5 }, { value: 'maybe', label: 'Maybe', points: 3 }, { value: 'no', label: 'No', points: 0 }] },
      { id: 'preferred_contact_method', field: 'preferred_contact_method', question: 'How would you like your mortgage broker to contact you?', type: 'select', max_points: 0, options: [{ value: 'phone', label: 'Phone call' }, { value: 'text', label: 'Text / SMS' }, { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'video_call', label: 'Video meeting' }, { value: 'in_person', label: 'In-person' }] },
      { id: 'best_time_to_contact', field: 'best_time_to_contact', question: 'Best time to contact you?', type: 'select', max_points: 0, options: [{ value: 'morning', label: 'Morning' }, { value: 'afternoon', label: 'Afternoon' }, { value: 'evening', label: 'Evening' }, { value: 'anytime', label: 'Anytime' }] },
    ],
  },
  agent: {
    type: 'agent',
    title: 'NESTI Real Estate Agent Lead Qualification',
    total_score: 100,
    questions: [
      { id: 'timeline', field: 'timeline', question: 'When are you planning to buy or sell?', type: 'select', max_points: 20, options: [{ value: 'asap', label: 'ASAP / Immediately', points: 20 }, { value: '1-3 months', label: '1–3 months', points: 15 }, { value: '3-6 months', label: '3–6 months', points: 10 }, { value: '6-12 months', label: '6–12 months', points: 5 }, { value: 'browsing', label: 'Just browsing', points: 0 }] },
      { id: 'mortgage_status', field: 'mortgage_status', question: 'Have you been pre-approved for a mortgage?', type: 'select', max_points: 15, options: [{ value: 'pre_approved', label: 'Pre-approved' }, { value: 'paying_cash', label: 'Cash buyer' }, { value: 'in_progress', label: 'In progress' }, { value: 'not_yet', label: 'Not yet' }, { value: 'unsure', label: 'Unsure' }] },
      { id: 'realtor_status', field: 'realtor_status', question: 'Are you currently working with a realtor?', type: 'select', max_points: 20, options: [{ value: 'no_agent', label: 'No agent' }, { value: 'has_agent_but_open', label: 'Yes but open to others' }, { value: 'has_exclusive_agent', label: 'Yes, exclusively' }] },
      { id: 'motivation_reason', field: 'motivation_reason', question: 'What is the main reason for your move?', type: 'select', max_points: 10, options: [{ value: 'relocation', label: 'Relocation' }, { value: 'family_change', label: 'Family change' }, { value: 'investment', label: 'Investment' }, { value: 'upgrading', label: 'Upgrading' }, { value: 'downsizing', label: 'Downsizing' }, { value: 'just_exploring', label: 'Just exploring' }] },
      { id: 'viewing_readiness', field: 'viewing_readiness', question: 'Would you like to start viewing properties soon?', type: 'select', max_points: 15, options: [{ value: 'asap', label: 'Yes ASAP' }, { value: 'few_weeks', label: 'Within a few weeks' }, { value: 'maybe_later', label: 'Maybe later' }, { value: 'just_browsing', label: 'Just browsing' }] },
      { id: 'living_situation', field: 'living_situation', question: 'Do you currently own or rent?', type: 'select', max_points: 10, options: [{ value: 'renting', label: 'Renting' }, { value: 'own_need_to_sell', label: 'Own but need to sell' }, { value: 'own_not_selling', label: 'Own and not selling' }] },
      { id: 'urgency_readiness', field: 'urgency_readiness', question: 'If you found the perfect home tomorrow, would you make an offer?', type: 'select', max_points: 10, options: [{ value: 'yes_immediately', label: 'Yes immediately' }, { value: 'maybe', label: 'Maybe' }, { value: 'no', label: 'No' }] },
      { id: 'preferred_contact_method', field: 'preferred_contact_method', question: 'Preferred contact method?', type: 'select', max_points: 0, options: [{ value: 'phone', label: 'Phone' }, { value: 'text', label: 'Text' }, { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'video_call', label: 'Video call' }, { value: 'in_person', label: 'In-person' }] },
      { id: 'best_time_to_contact', field: 'best_time_to_contact', question: 'Best time to contact?', type: 'select', max_points: 0, options: [{ value: 'morning', label: 'Morning' }, { value: 'afternoon', label: 'Afternoon' }, { value: 'evening', label: 'Evening' }, { value: 'anytime', label: 'Anytime' }] },
    ],
  },
  lawyer: {
    type: 'lawyer',
    title: 'NESTI Real Estate Lawyer Lead Qualification',
    total_score: 100,
    questions: [
      { id: 'transaction_stage', field: 'transaction_stage', question: 'What stage are you in right now?', type: 'select', max_points: 25, options: [{ value: 'offer_accepted', label: 'Offer accepted', points: 25 }, { value: 'actively_submitting', label: 'Actively submitting offers', points: 18 }, { value: 'pre_approval_stage', label: 'Pre-approval stage', points: 10 }, { value: 'just_researching', label: 'Just researching', points: 0 }] },
      { id: 'closing_timeline', field: 'closing_timeline', question: 'When is your expected closing date?', type: 'select', max_points: 20, options: [{ value: 'within_30_days', label: 'Within 30 days', points: 20 }, { value: '30_60_days', label: '30–60 days', points: 15 }, { value: '60_90_days', label: '60–90 days', points: 10 }, { value: 'unknown', label: 'Unknown', points: 0 }] },
      { id: 'transaction_type', field: 'transaction_type', question: 'What type of transaction is this?', type: 'select', max_points: 10, options: [{ value: 'home_purchase', label: 'Home purchase', points: 10 }, { value: 'home_sale', label: 'Home sale', points: 10 }, { value: 'refinance', label: 'Refinance', points: 6 }, { value: 'title_transfer', label: 'Title transfer', points: 6 }] },
      { id: 'property_value', field: 'property_value', question: 'What is the approximate property price?', type: 'select', max_points: 10, options: [{ value: '1m_plus', label: '$1M+', points: 10 }, { value: '700k_1m', label: '$700k–$1M', points: 8 }, { value: '400k_700k', label: '$400k–$700k', points: 6 }, { value: 'under_400k', label: 'Under $400k', points: 4 }] },
      { id: 'mortgage_status', field: 'mortgage_status', question: 'Has your mortgage been approved?', type: 'select', max_points: 10, options: [{ value: 'fully_approved', label: 'Fully approved', points: 10 }, { value: 'conditional_approval', label: 'Conditional approval', points: 7 }, { value: 'still_applying', label: 'Still applying', points: 3 }] },
      { id: 'realtor_involved', field: 'realtor_involved', question: 'Are you working with a realtor?', type: 'select', max_points: 5, options: [{ value: 'yes', label: 'Yes', points: 5 }, { value: 'no', label: 'No', points: 2 }] },
      { id: 'first_time_buyer', field: 'first_time_buyer', question: 'Is this your first home purchase?', type: 'select', max_points: 5, options: [{ value: 'yes', label: 'Yes', points: 5 }, { value: 'no', label: 'No', points: 3 }] },
      { id: 'legal_services_needed', field: 'legal_services_needed', question: 'What legal services do you need?', type: 'select', max_points: 10, options: [{ value: 'full_closing', label: 'Full closing services', points: 10 }, { value: 'title_transfer', label: 'Title transfer', points: 7 }, { value: 'document_review', label: 'Document review', points: 5 }] },
      { id: 'preferred_contact_method', field: 'preferred_contact_method', question: 'How would you like the lawyer to contact you?', type: 'select', max_points: 0, options: [{ value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }, { value: 'video_call', label: 'Video meeting' }] },
      { id: 'best_time_to_contact', field: 'best_time_to_contact', question: 'Best time to contact?', type: 'select', max_points: 0, options: [{ value: 'morning', label: 'Morning' }, { value: 'afternoon', label: 'Afternoon' }, { value: 'evening', label: 'Evening' }, { value: 'anytime', label: 'Anytime' }] },
    ],
  },
};

const resolveType = (type) => {
  const typeKey = String(type || '').toLowerCase().replace(/-/g, '_');
  if (typeKey === 'mortgage') return 'mortgage_broker';
  return typeKey;
};

export const getQuestionnaire = (type) => {
  const resolvedType = resolveType(type);
  const questionnaire = QUESTIONNAIRES[resolvedType] || QUESTIONNAIRES.mortgage_broker;

  return {
    success: true,
    type: questionnaire.type,
    title: questionnaire.title,
    total_score: questionnaire.total_score,
    questionnaire: questionnaire.questions,
  };
};

export const scoreQuestionnaire = (payload) => {
  return { success: true, scoreResult: {} };
};
