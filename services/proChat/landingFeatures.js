const f = (id, title, description, pains, questions) => ({ id, title, description, pains, questions });

export const SITE_FEATURES = {
  agent: [
    f('qualification', 'AI lead qualification', 'Collect budget, timeline and goals from every buyer and seller before you reply.', ['missed_inquiries', 'slow_response', 'conversion', 'phone_load'], ['missed', 'speed', 'assistant', 'challenge']),
    f('scoring', '0 to 100 lead scoring', 'See readiness at a glance and call the strongest opportunities first.', ['conversion'], ['volume', 'challenge']),
    f('crm', 'Built-in CRM', 'Keep contacts, lead details, conversations and status in one pipeline.', ['organization'], ['system']),
    f('follow_up', 'Automated follow-up', 'Stay in touch with warm prospects without manual reminders.', ['follow_up', 'admin_work'], ['time', 'challenge']),
    f('storefront', 'Professional storefronts', 'Give buyers and sellers a branded page to learn about you and send an inquiry.', ['no_website', 'lead_gen'], ['website', 'sources']),
    f('referrals', 'Referral network', 'Connect clients with mortgage brokers and real estate lawyers when they need support.', ['referrals'], ['referrals']),
  ],
  broker: [
    f('qualification', 'AI borrower qualification', 'Collect mortgage goals, purchase timelines, down payment details, and income information before your first conversation.', ['missed_inquiries', 'slow_response', 'conversion', 'admin_work', 'phone_load'], ['qualify', 'intake', 'delays']),
    f('scoring', '0–100 lead scoring', 'Review lead scores based on available qualification signals to identify borrowers who may be ready for the next step.', ['conversion'], ['volume', 'priority']),
    f('crm', 'Built-in CRM capabilities', 'Manage lead information, conversations, status updates, and next actions without relying on scattered records.', ['organization'], ['delays']),
    f('follow_up', 'Automated follow-up', 'Keep follow-up activity organized and maintain contact with borrowers who need more time before making a decision.', ['follow_up', 'renewals'], ['nurture', 'renewals', 'priority']),
    f('storefront', 'Professional storefronts', 'Present your mortgage services through a branded storefront where prospective clients can start an inquiry.', ['no_website', 'lead_gen'], ['website', 'sources']),
    f('referrals', 'Referral network', 'Connect with real estate professionals and manage relevant borrower introductions through Nesti’s referral network.', ['referrals'], ['referrals']),
  ],
  lawyer: [
    f('intake', 'AI-assisted client intake', 'Give prospective clients a clear way to explain their real estate matter, timeline, and contact preferences before your team responds.', ['missed_inquiries', 'slow_response', 'admin_work', 'phone_load'], ['inquiries', 'repetitive', 'afterhours', 'intake', 'automate', 'admin']),
    f('scoring', 'Lead qualification and scoring', 'Review available intake information and lead scores to identify which prospective clients may need attention first.', ['conversion'], ['volume']),
    f('crm', 'Built-in CRM capabilities', 'Maintain an accessible view of inquiries, contact details, lead status, and follow-up activity.', ['organization'], ['inquiries']),
    f('follow_up', 'Automated follow-up', 'Keep track of unanswered inquiries and next steps so potential clients aren\'t overlooked.', ['follow_up'], ['automate']),
    f('storefront', 'Professional storefronts', 'Create a branded online presence that introduces your practice and gives prospective clients a direct way to inquire.', ['no_website', 'lead_gen'], ['website', 'sources']),
    f('referrals', 'Professional referral network', 'Connect with real estate professionals who may introduce clients seeking legal services.', ['referrals'], ['referrals', 'network']),
  ],
  client: [
    f('fit', 'Find professionals who fit', 'Discover Realtors, mortgage brokers, and real estate lawyers based on your location and needs.', ['find_pro', 'home_search'], ['pros', 'matching', 'areas']),
    f('details', 'Share your details once', 'Keep your goals, preferences, and timeline together for more informed conversations.', [], ['compatibility', 'timeline']),
    f('decisions', 'Make better-informed decisions', 'Understand your next steps and discuss important questions with qualified professionals.', ['first_time', 'budget'], ['learn', 'confidence', 'budget']),
    f('conversations', 'Keep conversations organized', 'Track your messages and inquiries without losing sight of earlier discussions.', [], ['dashboard']),
    f('progress', 'Follow your progress', 'See where you are in your journey and what may need attention next.', ['saving'], ['tracker', 'saving', 'first']),
    f('support', 'Get support when you need it', 'Use Nesti to ask questions about the process and connect with professionals for specialized advice.', ['first_time'], ['challenge', 'goal']),
  ],
  investor: [
    f('scenarios', 'Compare property scenarios', 'Organize property options and the criteria that matter to your investment goals.', ['investing'], ['goal', 'learn']),
    f('financing', 'Explore financing options', 'Review financing scenarios and prepare clearer questions for your mortgage professional.', ['investing', 'budget'], ['budget', 'learn']),
    f('capital', 'Plan capital requirements', 'Keep down payment, savings, and other planning considerations visible as you evaluate a property.', ['investing', 'saving'], ['saving', 'tracker']),
    f('organized', 'Keep decisions organized', 'Use RAVI-powered planning tools to structure your research and identify useful next steps.', ['investing'], ['dashboard', 'confidence']),
  ],
};

export const HOME_STEPS = [
  f('capture', 'Capture', 'Your AI-powered storefront and chatbot let prospects connect with your business, even when you’re unavailable.', [], []),
  f('qualify', 'Qualify', 'AI collects information about budgets, timelines, goals, and preferences before your first conversation.', [], []),
  f('prioritize', 'Prioritize', 'Review intelligent lead scores from 0–100 to help identify prospects who may be ready to take the next step.', [], []),
  f('follow_up', 'Follow Up', 'Automated follow-up tools help you stay connected with prospects without relying on endless manual reminders.', [], []),
  f('connect', 'Connect', 'Connect clients with Realtors, mortgage brokers, and real estate lawyers through Nesti’s professional network.', [], []),
  f('grow', 'Grow', 'Manage your pipeline, track client conversations, and focus your time on relationships that move your business forward.', [], []),
];

const LABELS = { agent: 'real estate agent', broker: 'mortgage broker', lawyer: 'real estate lawyer', client: 'buyer or seller', investor: 'property investor' };

export function siteAudience(role, pains = []) {
  if (role === 'client' && pains.includes('investing')) return 'investor';
  return SITE_FEATURES[role] ? role : 'agent';
}

export function siteFeatures(audience) {
  return SITE_FEATURES[audience] || SITE_FEATURES.agent;
}

export function pickSiteFeatures(audience, { pains = [], questions = [] } = {}, count = 3) {
  const list = siteFeatures(audience);
  const score = (item) => {
    const pain = [...pains].reverse().findIndex((id) => item.pains.includes(id));
    const asked = questions.some((id) => item.questions.includes(id));
    return (pain >= 0 ? 100 - pain : 0) + (asked ? 10 : 0);
  };
  return list
    .map((item, index) => ({ item, index, rank: score(item) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, count)
    .map(({ item }) => item);
}

export function featureForPain(audience, painId) {
  return siteFeatures(audience).find((item) => item.pains.includes(painId)) || null;
}

export function featureLine(item) {
  return `${item.title}: ${item.description}`;
}

export function siteFeaturesBrief(role) {
  const key = role === 'client' ? 'client' : SITE_FEATURES[role] ? role : 'agent';
  const lines = [`Nesti website features for a ${LABELS[key]}: ${siteFeatures(key).map(featureLine).join(' ')}`];
  if (key === 'client') lines.push(`For a ${LABELS.investor}: ${siteFeatures('investor').map(featureLine).join(' ')}`);
  return `${lines.join(' ')} When they ask why Nesti or what it does for them, answer with two or three of these, in your own short words, tied to what they told you.`;
}

export function asksHowNestiIsDifferent(value) {
  const spoken = String(value || '').trim().toLowerCase();
  return /\b(different|difference|compare|comparison|stand out|versus|vs\.?)\b/.test(spoken)
    || /\b(why nesti|why choose|what makes (you|nesti)|better than)\b/.test(spoken);
}

const WHY_NEED = /\bwhy (should|would|do|must|shall) (i|we) (need|join|use|choose|pick|sign up (for|with)|subscribe (to)?|pay for|go with|buy)\b|\bwhy (do i|would i) (want|need) (this|it|nesti|you)\b|\bwhy (join|use|pay for|sign up for) (nesti|this|it)\b|\bwhat('?s| is) in it for (me|us)\b|\bwhat (do|will|would) (i|we) get (from|out of|with) (nesti|this|it)\b|\bhow (will|would|can|does|is) (nesti|this|it|that) (going to )?help (me|us|my business|my practice)\b|\bwhat can (nesti|you) do for (me|us)\b|\bwhy do i need\b|\bwhy nesti\b|کیوں (جوائن|شامل|استعمال)|نیسٹی کیوں/i;

export function asksWhyNesti(value) {
  const spoken = String(value || '').trim();
  if (!spoken) return false;
  return WHY_NEED.test(spoken) || (asksHowNestiIsDifferent(spoken) && /\b(nesti|you|yours|others|other (apps?|tools?|crms?|platforms?|companies|software))\b/i.test(spoken));
}
