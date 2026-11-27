import { BILLING_PLANS } from '../billing/plans.js';
import { BASIC_FEATURES, ENTERPRISE_FEATURES, FEATURES, PLAN_LIMITS, STANDARD_FEATURES } from '../billing/entitlements.js';
import { CLIENT_PLANS, recommendClientPlan } from '../client/plans.js';
import { displayFeaturesForTier } from '../client/entitlements.js';
import { QUESTION_GUIDES } from './salesQuestionGuides.js';
import { asksWhyNesti, featureForPain, pickSiteFeatures, siteAudience } from './landingFeatures.js';

function text(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const q = (id, question, ask, heard = null) => ({ id, text: question, ask, heard });

const CITY = /\b(toronto|gta|mississauga|brampton|oakville|markham|vaughan|ottawa|hamilton|london|kitchener|waterloo|vancouver|surrey|burnaby|calgary|edmonton|winnipeg|montreal|quebec|halifax|ontario|alberta|british columbia|bc|new york|new jersey|los angeles|chicago|houston|dallas|austin|miami|florida|texas|california|seattle|boston|atlanta|lahore|karachi|islamabad)\b|ٹورنٹو|لاہور|کراچی|اسلام آباد/i;
const VOLUME = /\b\d+\s*(leads?|inquir\w*|clients?|borrowers?|files?|deals?|calls?|a month|per month|monthly|every month)\b|\b(few|dozen|hundreds?|handful)\b[^.]*\b(leads?|inquir\w*|month)\b/i;
const SOURCES = /\b(referrals?|word of mouth|zillow|realtor\.ca|facebook|instagram|tiktok|google|ads?|website|open houses?|sphere|social media|walk-?ins?|repeat clients?|past clients?|banks?|realtors? send)\b/i;
const SYSTEMS = /\b(crm|spreadsheets?|excel|google sheets?|notebook|follow up boss|kvcore|salesforce|hubspot|lion desk|clio|velocity|filogix|manually|my phone|my head|email)\b/i;
const SPEED = /\b(within|minutes?|hours?|same day|next day|right away|instantly|immediately|a day|days|asap)\b/i;
const MONEY = /\$\s?\d|\b\d[\d,.]*\s?(k|thousand|million|lakh|crore|dollars?)\b|\bbudget (is|of|around)\b|ڈالر|لاکھ|کروڑ/i;
const TIMELINE = /\b(\d+|three|six|few)\s*(months?|weeks?|years?)\b|\b(this|next) (year|month|spring|summer|fall|winter)\b|\b(asap|soon|right away|just exploring|exploring|no rush)\b/i;

const PIPELINES = {
  agent: {
    label: 'realtor',
    opening: ['setup', 'markets', 'clients', 'volume', 'challenge'],
    approach: 'lead management, AI-powered conversations, CRM, automated follow-ups, customizable websites, and professional referrals',
    demo: 'For example, a buyer messages your page at nine at night about a condo. Nesti replies in seconds, asks their budget and timeline, scores the lead, and books a showing on your calendar.',
    questions: [
      q('setup', 'Are you an independent realtor, part of a team, or managing a brokerage?', /independent realtor|part of a team|managing a brokerage/i, /\b(independent|solo|on my own|by myself|my team|a team|brokerage|team lead|broker of record)\b/i),
      q('markets', 'Which cities or markets do you currently serve?', /cities or markets|which (cities|markets|areas)/i, CITY),
      q('clients', 'Do you primarily work with buyers, sellers, investors, or all three?', /buyers, sellers|buyers or sellers|work with buyers/i, /\b(buyers?|sellers?|investors?|all three|both)\b/i),
      q('volume', 'Approximately how many new leads do you receive monthly?', /how many (new )?leads/i, VOLUME),
      q('sources', 'Where do most of your leads currently come from?', /where do (most of )?your leads/i, SOURCES),
      q('system', 'How are you currently managing your leads and client conversations?', /how are you (currently )?managing/i, SYSTEMS),
      q('missed', 'Do you sometimes miss inquiries while attending showings or appointments?', /miss (inquiries|calls|leads)/i),
      q('speed', 'How quickly do you typically respond to new leads?', /how quickly|how fast/i, SPEED),
      q('challenge', "What's your biggest challenge: generating leads, following up, or converting clients?", /biggest challenge/i, /\b(generat\w+ leads?|getting leads|following up|follow[- ]?ups?|convert\w*)\b/i),
      q('website', 'Do you currently have a professional website that generates leads and appointments?', /professional website|have a website/i, /\b(website|web ?site|landing page)\b/i),
      q('time', 'How much time do you spend weekly on repetitive follow-ups and administrative tasks?', /how much time/i, /\b\d+\s*(hours?|hrs)\b|\b(all day|whole day|too much time|lot of time)\b/i),
      q('assistant', 'Would an AI assistant that responds to inquiries, qualifies prospects, and schedules appointments benefit your business?', /ai assistant that responds/i),
      q('referrals', 'Are you interested in expanding your referral network with mortgage brokers and lawyers?', /referral network/i, /\breferr?al/i),
      q('goal', 'What is the biggest improvement you would like to make to your business in the next 90 days?', /next (90|ninety) days|biggest improvement/i),
      q('close', 'Would you prefer to explore a personalized Nesti subscription or see a demonstration?', /subscription or see a demo|explore a personalized nesti subscription/i, /\b(demo|demonstration|sign me up|sign up|subscribe|start (the |a )?trial)\b/i),
    ],
  },
  broker: {
    label: 'mortgage broker',
    opening: ['setup', 'licensed', 'clients', 'volume', 'qualify'],
    approach: 'borrower acquisition, qualification, automated nurturing, renewal follow-ups, appointment scheduling, and professional referral opportunities',
    demo: 'For example, a borrower asks about pre-approval late at night. Nesti answers, collects the income and down-payment basics, and books a call; if they are not ready, it keeps following up and reminds them before renewal.',
    questions: [
      q('setup', 'Are you an independent broker, part of a brokerage, or managing a team?', /independent broker|part of a brokerage|managing a team/i, /\b(independent|solo|on my own|by myself|brokerage|my team|a team)\b/i),
      q('licensed', 'Which provinces or states are you licensed to serve?', /provinces or states|licensed to serve/i, CITY),
      q('clients', 'Do you primarily assist first-time buyers, refinancing clients, renewals, or investors?', /first-time buyers, refinanc|refinancing clients/i, /\b(first[- ]time|refinanc\w*|renewals?|investors?|all of them)\b/i),
      q('volume', 'Approximately how many mortgage inquiries do you receive monthly?', /how many (mortgage )?inquiries/i, VOLUME),
      q('sources', 'Where do most of your borrowers come from?', /where do (most of )?your borrowers/i, SOURCES),
      q('qualify', 'How do you currently qualify incoming mortgage inquiries?', /how do you (currently )?qualify/i, /\b(qualif\w+|pre-?approv\w*|application|credit check|phone call|questionnaire|forms?)\b/i),
      q('nurture', 'How do you follow up with borrowers who are not ready to proceed?', /not ready to proceed|follow up with borrowers/i),
      q('renewals', 'Do you have a system for reconnecting with clients before their mortgage renewals?', /before their (mortgage )?renewals?|reconnecting with clients/i),
      q('delays', 'Do you experience delays with collecting information, arranging appointments, or following up?', /experience delays/i, /\b(delays?|slow|chasing documents|waiting on)\b/i),
      q('website', 'Do you currently have a professional website that generates mortgage consultations?', /professional website|have a website/i, /\b(website|web ?site|landing page)\b/i),
      q('intake', 'Would automated borrower intake and appointment scheduling save your team time?', /automated borrower intake/i),
      q('referrals', 'How do you currently develop referral relationships with realtors and lawyers?', /referral relationships/i, /\breferr?al/i),
      q('priority', 'Would more inquiries, better-qualified borrowers, or stronger client retention benefit your business most?', /better-qualified borrowers|stronger client retention/i, /\b(more inquiries|better[- ]qualified|retention|keep(ing)? clients)\b/i),
      q('goal', 'What would you like to improve in your business over the next three months?', /next three months|next 3 months/i),
      q('close', 'Would you like RAVI to demonstrate a Nesti subscription tailored to your business?', /demonstrate a nesti subscription/i, /\b(demo|demonstration|sign me up|sign up|subscribe|start (the |a )?trial)\b/i),
    ],
  },
  lawyer: {
    label: 'real estate lawyer',
    opening: ['setup', 'jurisdictions', 'matters', 'volume', 'inquiries'],
    approach: 'streamlining client intake, reducing repetitive administrative work, increasing consultations, enhancing the firm online presence, and expanding professional referrals',
    demo: 'For example, a buyer asks at night what to expect at closing. Nesti gives general information only, collects their details and closing date, and books a consultation; your firm still runs its own conflict check and engagement steps.',
    questions: [
      q('setup', 'Are you a solo practitioner, part of a law firm, or managing a real estate practice?', /solo practitioner|part of a law firm/i, /\b(solo|sole practitioner|on my own|law firm|our firm|my firm|partner|associate|practice)\b/i),
      q('jurisdictions', 'Which jurisdictions are you licensed to practice in?', /jurisdictions?/i, CITY),
      q('matters', 'Do you primarily handle residential closings, commercial transactions, refinancing, or investor matters?', /residential closings|commercial transactions/i, /\b(residential|commercial|closings?|refinanc\w*|investors?|title)\b/i),
      q('volume', 'Approximately how many new real estate inquiries does your firm receive monthly?', /how many (new )?(real estate )?inquiries/i, VOLUME),
      q('sources', 'Where do most of your clients come from?', /where do (most of )?your clients/i, SOURCES),
      q('inquiries', 'How does your firm currently manage prospective client inquiries?', /manage prospective client inquiries|how does your firm (currently )?manage/i, SYSTEMS),
      q('repetitive', 'Does your team spend significant time answering repetitive questions?', /repetitive questions/i, /\b(same questions|repetitive|over and over)\b/i),
      q('afterhours', 'How do you handle consultation requests outside business hours?', /outside (of )?business hours|after hours/i, /\b(after hours|evenings?|weekends?|voicemail|next morning)\b/i),
      q('intake', 'How do you currently collect initial client information?', /collect initial client information/i, /\b(intake forms?|forms?|email|phone call|paper|questionnaire)\b/i),
      q('website', 'Does your firm have a professional website that converts visitors into consultations?', /professional website|have a website/i, /\b(website|web ?site|landing page)\b/i),
      q('automate', 'Would automated initial inquiries and appointment scheduling benefit your practice?', /automated initial inquiries/i),
      q('referrals', 'How important are realtor and mortgage broker referrals to your business?', /how important are realtor/i, /\breferr?al/i),
      q('network', 'Are you interested in growing your professional referral network?', /growing your professional referral network/i),
      q('admin', 'Which administrative task would you most like to automate?', /administrative task/i, /\b(intake|scheduling|reminders?|document collection|paperwork|billing)\b/i),
      q('close', 'Would you like to explore a Nesti subscription tailored to your practice?', /subscription tailored to your practice/i, /\b(demo|demonstration|sign me up|sign up|subscribe|start (the |a )?trial)\b/i),
    ],
  },
  client: {
    label: 'client',
    opening: ['goal', 'areas', 'timeline', 'first', 'budget', 'challenge'],
    approach: 'financial planning tools, down-payment tracking, personalized real estate guidance, professional matching, and the centralized Nesti ecosystem',
    demo: 'For example, tell Nesti your target area and savings, and it tracks your down payment, shows what you can afford, and matches you with an agent who fits you.',
    questions: [
      q('goal', 'Are you looking to buy, sell, invest, or explore your real estate options?', /buy, sell, invest|buy or sell|looking to buy/i, /\b(buy|buying|purchase|sell|selling|invest\w*|rent\w*|explor\w*|looking (for|to) (a |an )?(buy|sell|invest|house|home|condo|place|property))\b|\b(want|need|looking for) (a|an) (house|home|condo|place|property)\b|خرید|بیچ|سرمایہ/i),
      q('first', 'Is this your first property transaction?', /first property transaction|first (home|property)/i, /\b(first[- ]time|first (home|house|property)|never bought|bought before|second (home|property))\b/i),
      q('areas', 'Which cities or areas are you interested in?', /cities or areas|which (city|cities|area|areas)/i, CITY),
      q('timeline', 'Are you planning to make a move within three months, six months, a year, or are you exploring?', /three months, six months|planning to make a move/i, TIMELINE),
      q('challenge', 'What is your biggest challenge with your real estate goals?', /biggest challenge/i),
      q('budget', 'Do you have a budget in mind, or would you like help exploring your options?', /budget in mind|budget/i, MONEY),
      q('saving', 'Are you currently saving toward a down payment or investment?', /saving toward/i, /\b(sav(e|ing)|down ?payment|deposit)\b/i),
      q('tracker', 'Would a personalized savings and down-payment tracker be useful?', /savings and down-payment tracker|down-payment tracker/i),
      q('pros', 'Are you currently working with a realtor, mortgage broker, or lawyer?', /working with a realtor/i, /\b(my (realtor|agent|broker|lawyer)|working with (a|an) (realtor|agent|broker|lawyer)|no (realtor|agent))\b/i),
      q('matching', 'Would you prefer to choose your own professionals or receive personalized matches?', /choose your own professionals|personalized matches/i),
      q('compatibility', 'How important are communication preferences and professional compatibility to you?', /communication preferences/i),
      q('dashboard', 'Would you benefit from managing your savings, property goals, and professional conversations in one dashboard?', /one dashboard/i),
      q('learn', 'Are you interested in learning more about financing, homeownership, or property investing?', /learning more about financing/i),
      q('confidence', 'What would help you feel more confident about your next step?', /more confident/i),
      q('close', 'Would you like to explore a personalized Nesti client subscription or connect with a suitable professional?', /nesti client subscription|connect with a suitable professional/i, /\b(sign me up|sign up|subscribe|start (the |a )?trial|connect me)\b/i),
    ],
  },
};

const PAIN_POINTS = [
  { id: 'missed_inquiries', roles: ['agent', 'broker', 'lawyer'], pattern: /\bmiss(ed|ing)? (a lot of |some |many )?(calls?|leads?|inquir\w*|messages?)|\bcan'?t (always )?(answer|pick up)|\bvoicemail|\b(during|at|in) (showings?|appointments?|meetings?|court|closings?)\b|\bafter hours\b/i, label: 'missed inquiries', connect: { agent: 'instant lead response: the Nesti chatbot answers every inquiry in seconds, day or night, qualifies it, and books the appointment', broker: 'instant borrower response: Nesti answers every inquiry right away and books the call', lawyer: 'automated client inquiry handling: Nesti answers new inquiries at any hour and books the consultation' }, follow: ['speed', 'assistant', 'afterhours', 'automate', 'intake'], plan: 'basic' },
  { id: 'slow_response', roles: ['agent', 'broker', 'lawyer'], pattern: /\b(takes?|took) (me )?(hours|a day|days)|\bslow to (respond|reply)|\brespond (late|slowly)|\bnext day\b/i, label: 'slow response', connect: { agent: 'instant lead response that replies in seconds', broker: 'instant borrower response that replies in seconds', lawyer: 'automated inquiry replies in seconds' }, follow: ['assistant', 'automate', 'intake'], plan: 'basic' },
  { id: 'follow_up', roles: ['agent', 'broker', 'lawyer'], pattern: /\bfollow(ing)?[- ]?ups?\b|\bnurtur\w*|\bnot ready\b|\bgo(es|ing)? cold\b|\bcold leads?\b|\bchas(e|ing)\b|\bforget to (call|follow)/i, label: 'follow-ups', connect: { agent: 'automated follow-ups: Nesti sends personalized follow-up sequences so no lead goes cold', broker: 'borrower nurturing: automated follow-ups keep not-ready borrowers warm until they are ready', lawyer: 'automated follow-ups that keep prospective clients engaged until they book' }, follow: ['time', 'nurture', 'renewals', 'assistant'], plan: 'standard' },
  { id: 'renewals', roles: ['broker'], pattern: /\brenewals?\b|\b(term|mortgage) (ends|expires|is up)\b/i, label: 'renewals', connect: { broker: 'renewal follow-ups: Nesti reconnects with past clients before their mortgage renews' }, follow: ['renewals', 'priority'], plan: 'standard' },
  { id: 'lead_gen', roles: ['agent', 'broker', 'lawyer'], pattern: /\b(need|want|get|more|generat\w*|finding) (more )?(new )?(leads|clients|business|inquiries|borrowers|consultations)\b|\bnot enough (leads|clients|business|inquiries)\b|\bslow (market|month)s?\b/i, label: 'generating leads', connect: { agent: 'AI lead generation: a Nesti storefront and chatbot capture and score new inquiries, and Nesti matches you with clients', broker: 'borrower acquisition: a Nesti storefront and chatbot capture new borrowers, and Nesti matches you with clients', lawyer: 'more consultations: a Nesti storefront and chatbot turn visitors into booked consultations' }, follow: ['sources', 'website', 'referrals'], plan: 'standard' },
  { id: 'conversion', roles: ['agent', 'broker', 'lawyer'], pattern: /\bconvert\w*|\bconversion|\btire kickers?\b|\bunqualified\b|\bnot serious\b|\bwast(e|ing) (my )?time\b|\bqualify\w*/i, label: 'converting leads', connect: { agent: 'lead scoring: Nesti scores each inquiry so you spend your time on serious buyers and sellers', broker: 'borrower qualification: Nesti collects the basics and scores each inquiry before you call', lawyer: 'inquiry screening: Nesti collects the basics so your team spends time on real matters' }, follow: ['qualify', 'challenge', 'priority'], plan: 'basic' },
  { id: 'no_website', roles: ['agent', 'broker', 'lawyer'], pattern: /\b(no|don'?t have a|without a|old|outdated|basic) (professional )?(website|site)\b|\bwebsite (is )?(old|outdated|doesn'?t)/i, label: 'no website that converts', connect: { agent: 'a customizable Nesti storefront with a built-in chatbot that turns visitors into leads and showings', broker: 'a customizable Nesti storefront that turns visitors into mortgage consultations', lawyer: 'a professional Nesti storefront that turns visitors into consultations' }, follow: ['website'], plan: 'standard' },
  { id: 'admin_work', roles: ['agent', 'broker', 'lawyer'], pattern: /\badmin(istrative)?\b|\bpaperwork\b|\bdata entry\b|\brepetitive\b|\bsame questions\b|\bintake\b|\bcollect(ing)? (the )?(client )?(info|information|documents|details)\b|\bscheduling\b/i, label: 'administrative work', connect: { agent: 'an AI assistant that handles routine questions, intake, and scheduling for you', broker: 'automated borrower intake and appointment scheduling', lawyer: 'automated client intake: Nesti answers common questions, collects client details, and books the consultation, while your firm keeps its own conflict checks' }, follow: ['time', 'intake', 'admin', 'repetitive'], plan: 'standard' },
  { id: 'referrals', roles: ['agent', 'broker', 'lawyer'], pattern: /\breferr?als?\b|\bpartner(s|ships)? with (realtors?|brokers?|lawyers?)/i, label: 'referrals', connect: { agent: 'the Nesti professional network, with referral invites to mortgage brokers and lawyers', broker: 'referral invites with realtors and lawyers on Nesti', lawyer: 'realtor and mortgage broker referrals through the Nesti network' }, follow: ['referrals', 'network'], plan: 'standard' },
  { id: 'organization', roles: ['agent', 'broker', 'lawyer'], pattern: /\bspreadsheets?\b|\bexcel\b|\bnotebook\b|\ball over the place\b|\bdisorganized\b|\blose track\b|\bno (crm|system)\b/i, label: 'staying organized', connect: { agent: 'the Nesti CRM: every lead, conversation, and follow-up in one place', broker: 'the Nesti CRM for every borrower and conversation', lawyer: 'one inbox for every prospective client and conversation' }, follow: ['system', 'inquiries'], plan: 'basic' },
  { id: 'phone_load', roles: ['agent', 'broker', 'lawyer'], pattern: /\bphone calls?\b|\banswer(ing)? (the )?phone\b|\bcalls? all day\b|\bcold call\w*|\bvoice (agent|assistant)\b/i, label: 'phone load', connect: { agent: 'the Nesti AI voice agent, which answers and makes calls like this one', broker: 'the Nesti AI voice agent, which answers borrower calls like this one', lawyer: 'the Nesti AI voice agent, which answers inquiry calls like this one' }, follow: ['assistant', 'automate'], plan: 'enterprise' },
  { id: 'saving', roles: ['client'], pattern: /\bsav(e|ing)\b|\bdown ?payment\b|\bdeposit\b/i, label: 'saving for a down payment', connect: { client: 'the down-payment and savings tracker' }, follow: ['saving', 'tracker'], plan: 'planning' },
  { id: 'budget', roles: ['client'], pattern: /\bafford\w*|\bhow much can i\b|\btight budget\b|\bbudget is (tight|low|small)\b|\btoo expensive\b|\bmortgage payments?\b|\bnot sure (about|of) (my |the )?budget\b/i, label: 'budget', connect: { client: 'budget and affordability tools that show what fits their savings' }, follow: ['saving', 'learn'], plan: 'planning' },
  { id: 'find_pro', roles: ['client'], pattern: /\b(find|need|want|looking for) (a |an |the right )?(good )?(realtor|agent|broker|lawyer|professional)s?\b|\btrust\w*\b/i, label: 'finding the right professional', connect: { client: 'professional matching with an agent, broker, or lawyer who fits them' }, follow: ['pros', 'matching', 'compatibility'], plan: 'essential' },
  { id: 'first_time', roles: ['client'], pattern: /\bfirst[- ]time\b|\bfirst (home|house|property)\b|\b(don'?t|do not) know (where|how) to start\b|\bconfus\w*|\boverwhelm\w*/i, label: 'first-time uncertainty', connect: { client: 'a personalized planning dashboard that walks them through each step' }, follow: ['learn', 'confidence', 'dashboard'], plan: 'planning' },
  { id: 'investing', roles: ['client'], pattern: /\binvest\w*|\brental\b|\bcash ?flow\b|\broi\b|\bportfolio\b/i, label: 'investing', connect: { client: 'investment scenario calculators and property comparisons' }, follow: ['learn', 'budget'], plan: 'analysis' },
  { id: 'home_search', roles: ['client'], pattern: /\b(looking for|want|need|find|buy|have) (a |an )?(house|home|condo|townhouse|property|place|apartment)\b|\blistings?\b|\bavailable\b/i, label: 'finding a home', connect: { client: 'property recommendations and a matched local agent who can share listings' }, follow: ['areas', 'budget', 'timeline'], plan: 'essential' },
];

const ROLE_HINTS = [
  { role: 'broker', pattern: /\bmortgage (broker|agent|specialist|advisor)\b|\bi'?m a (mortgage )?broker\b|\bi do mortgages\b/i },
  { role: 'lawyer', pattern: /\b(real estate )?(lawyer|attorney|solicitor|notary|paralegal)\b|\blaw (firm|practice|office)\b|\bpractice law\b/i },
  { role: 'agent', pattern: /\b(realtor|real estate agent|real estate broker|sales (rep|representative))\b|\bi'?m an agent\b/i },
];

const CLOSERS = {
  roi: 'If you were able to convert even one additional qualified lead from the inquiries you are already receiving, what could that mean for your business?',
  time: 'Would having an AI assistant handle initial inquiries and follow-ups free up valuable time each week?',
  growth: 'What would change for your business if you had a more consistent system for responding to every potential client?',
  demo: 'Would you like to hear an example of how RAVI could handle an incoming inquiry for your business?',
  subscribe: 'Based on what you have shared, I have a Nesti subscription recommendation for you. Would you like to explore it now or see a personalized demonstration?',
};

const PAIN_CLOSER = { missed_inquiries: 'roi', slow_response: 'roi', conversion: 'roi', follow_up: 'time', admin_work: 'time', renewals: 'time', lead_gen: 'growth', no_website: 'growth', organization: 'growth', referrals: 'growth', phone_load: 'time' };

const PRO_FEATURE_LABELS = [
  [FEATURES.LEADS_CAPTURE, 'AI lead capture'],
  [FEATURES.CHATBOT_BASIC, 'chatbot'],
  [FEATURES.LEADS_SCORING, 'lead scoring'],
  [FEATURES.CRM_BASIC_LIST, 'CRM'],
  [FEATURES.PUBLIC_PROFILE, 'customizable storefront'],
  [FEATURES.LEADS_FOLLOWUP_AUTOMATED, 'automated follow-ups'],
  [FEATURES.CALENDAR_INTEGRATION, 'calendar booking'],
  [FEATURES.REFERRALS_INVITES, 'referral invites'],
  [FEATURES.VOICE_AGENT, 'AI voice agent'],
];

const PRO_FEATURE_SETS = { basic: BASIC_FEATURES, standard: STANDARD_FEATURES, enterprise: ENTERPRISE_FEATURES };
const PLAN_ORDER = ['basic', 'standard', 'enterprise'];

export const SALES_PIPELINES = PIPELINES;

const QUESTION_PARTS = { text: 300, answers: 300, reply: 200 };

export function defaultQuestions(role) {
  const key = pipelineRole(role);
  const list = PIPELINES[key]?.questions || [];
  const guides = QUESTION_GUIDES[key] || {};
  return list.map((item) => ({ id: item.id, text: item.text, answers: guides[item.id]?.[0] || '', reply: guides[item.id]?.[1] || '' }));
}

// Only the parts that differ from the built-in question are kept.
export function questionOverrides(role, saved) {
  const defaults = Object.fromEntries(defaultQuestions(role).map((item) => [item.id, item]));
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const out = {};
  for (const [id, value] of Object.entries(source)) {
    if (!defaults[id]) continue;
    const given = value && typeof value === 'object' && !Array.isArray(value) ? value : { text: value };
    const kept = {};
    for (const [part, limit] of Object.entries(QUESTION_PARTS)) {
      if (given[part] === undefined) continue;
      const next = text(given[part]).slice(0, limit);
      if (next && next !== defaults[id][part]) kept[part] = next;
    }
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

export function questionsWithOverrides(role, saved) {
  const custom = questionOverrides(role, saved);
  return defaultQuestions(role).map((item) => ({ ...item, ...(custom[item.id] || {}) }));
}

const ASKING_BACK = /[?؟]\s*$|^(what|how|why|who|where|when|which|can|could|do|does|is|are|will|would)\b|\b(let me know|tell me|explain|first of all|before (that|i answer)|what (are|is) (the|your) (services?|price|cost)|how (you|it|this|nesti) (are )?work)/i;
const UNSURE = /\b(not sure|don'?t know|no idea|undecided|flexible|anywhere|haven'?t decided|still deciding|depends)\b/i;
const OWNS_PLACE = /\b(i|we) (have|own|got) (a|an|my|our|one|two) (house|home|condo|property|place|apartment|townhouse)\b|\b(my|our) (house|home|condo|property|place|apartment) in\b|\b(have|own) (a )?(house|home|property) in\b/i;
const FILLER_ONLY = /^(hmm+|um+|uh+|so|well|just|like|you know|i mean|\s)+$/i;
const TRAILING_OFF = /(\.\.\.|…|\byou know\W*)$/i;

function realAnswer(item, line) {
  const words = line.split(' ').filter(Boolean).length;
  if (!words || FILLER_ONLY.test(line.replace(/[.,!…]/g, ' ').trim())) return false;
  if (TRAILING_OFF.test(line) && !item?.heard?.test(line)) return false;
  if (item?.heard?.test(line)) return true;
  if (ASKING_BACK.test(line)) return false;
  if (UNSURE.test(line)) return true;
  return item?.heard ? words <= 8 : words >= 1;
}

const ANSWER_SKIP = /\b(yes|no|not|maybe|sure|depends|either|honestly|varies|important|somewhat|definitely|really)\b/i;

function answerPhrases(answers) {
  return text(answers)
    .split(';')
    .map((phrase) => text(phrase).toLowerCase())
    .filter((phrase) => phrase.split(' ').length >= 2 && phrase.length >= 8 && !ANSWER_SKIP.test(phrase));
}
export const SALES_CLOSERS = CLOSERS;

export function pipelineRole(role) {
  const value = text(role).toLowerCase();
  if (value === 'client' || value === 'lead') return 'client';
  if (value === 'broker' || value === 'mortgage_broker' || value === 'mortgage broker') return 'broker';
  if (value === 'lawyer' || value === 'real_estate_lawyer') return 'lawyer';
  if (value === 'agent' || value === 'realtor' || value === 'real_estate_agent') return 'agent';
  return '';
}

export function professionalPlanFeatures(planKey) {
  const set = PRO_FEATURE_SETS[planKey];
  if (!set) return [];
  return PRO_FEATURE_LABELS.filter(([feature]) => set.has(feature)).map(([, label]) => label);
}

function leadLimitNote(planKey) {
  const leads = PLAN_LIMITS?.[planKey]?.captured_leads;
  return Number.isFinite(leads) ? `up to ${leads} captured leads` : 'unlimited leads';
}

export function professionalPlanLine(planKey) {
  const plan = BILLING_PLANS[planKey];
  if (!plan) return '';
  return `${plan.name}: ${professionalPlanFeatures(planKey).join(', ')}, ${leadLimitNote(planKey)}`;
}

export function professionalPlansSummary() {
  return PLAN_ORDER.filter((key) => BILLING_PLANS[key]).map(professionalPlanLine).join('. ');
}

function leadVolume(answer) {
  const match = text(answer).match(/\b(\d{1,4})\b/);
  return match ? Number(match[1]) : 0;
}

export function recommendPlan(role, painIds = [], answers = {}) {
  const key = pipelineRole(role) || 'agent';
  const pains = PAIN_POINTS.filter((pain) => painIds.includes(pain.id));
  if (key === 'client') {
    const assistance = pains.some((pain) => pain.plan === 'analysis')
      ? 'analysis'
      : pains.some((pain) => pain.plan === 'planning') ? 'planning' : '';
    const tier = recommendClientPlan({ assistance });
    const plan = CLIENT_PLANS[tier];
    return plan ? { key: tier, name: plan.name, features: displayFeaturesForTier(tier, { includeInherited: false }) } : null;
  }
  let rank = 0;
  for (const pain of pains) rank = Math.max(rank, PLAN_ORDER.indexOf(pain.plan));
  const basicLeads = PLAN_LIMITS?.basic?.captured_leads;
  if (Number.isFinite(basicLeads) && leadVolume(answers.volume) * 12 > basicLeads) rank = Math.max(rank, 1);
  const planKey = PLAN_ORDER[Math.max(0, rank)];
  const plan = BILLING_PLANS[planKey];
  if (!plan) return null;
  const below = rank > 0 ? professionalPlanFeatures(PLAN_ORDER[rank - 1]) : [];
  const features = professionalPlanFeatures(planKey);
  return { key: planKey, name: plan.name, features, adds: below.length ? ['everything in the plan below', ...features.filter((item) => !below.includes(item))] : features };
}

function short(answer, words = 8) {
  const list = text(answer).split(' ');
  return list.length > words ? `${list.slice(0, words).join(' ')}...` : list.join(' ');
}

const COMMON_WORDS = new Set([
  'about', 'after', 'again', 'approximately', 'around', 'being', 'could', 'currently', 'every', 'their', 'there',
  'these', 'thing', 'things', 'think', 'those', 'typically', 'usually', 'where', 'which', 'while', 'would', 'should',
  'primarily', 'mostly', 'really', 'right', 'other', 'still', 'something', 'today', 'business', 'prefer',
  'your', 'with', 'what', 'have', 'that', 'this', 'from', 'they', 'does', 'many', 'much', 'more', 'most', 'like',
  'want', 'make', 'work', 'been', 'will', 'just', 'when', 'into', 'some', 'also', 'then', 'than', 'them', 'were',
  'part', 'help', 'kind', 'sort', 'okay', 'sure', 'great', 'good', 'nesti',
]);

function contentWords(line) {
  return new Set((text(line).toLowerCase().match(/[a-z]+/g) || [])
    .filter((word) => word.length >= 4 && !COMMON_WORDS.has(word))
    .map((word) => word.replace(/(ing|ed|es|s)$/, '')));
}

function sharesContentWord(line, questionText) {
  if (!questionText) return false;
  const wanted = contentWords(questionText);
  for (const word of contentWords(line)) if (wanted.has(word)) return true;
  return false;
}

export function createSalesPipeline(role, { roleKnown, questions, faqAnswer } = {}) {
  const fixedClient = pipelineRole(role) === 'client';
  const homeRole = pipelineRole(role) || 'agent';
  const customQuestions = questionOverrides(homeRole, questions);
  const guides = {};
  const guideFor = (role) => {
    guides[role] ||= Object.fromEntries(defaultQuestions(role).map((item) => [item.id, item]));
    return guides[role];
  };
  const state = {
    role: pipelineRole(role) || 'agent',
    roleKnown: roleKnown ?? Boolean(pipelineRole(role)),
    answers: {},
    asked: [],
    offered: '',
    pending: '',
    pains: [],
    pitched: false,
    closers: [],
    callerTurns: 0,
    callerWords: 0,
    nextStep: '',
    nextOffered: false,
    possibleSeller: false,
    sellerAsked: false,
    followUpConsent: false,
    doNotCall: false,
    outcome: '',
    plan: '',
  };
  const pipeline = () => PIPELINES[state.role];
  const question = (id) => {
    const item = pipeline().questions.find((entry) => entry.id === id);
    if (!item) return undefined;
    const guide = guideFor(state.role)[id] || {};
    const custom = state.role === homeRole ? customQuestions[id] || {} : {};
    return { ...item, answers: custom.answers || guide.answers || '', reply: custom.reply || guide.reply || '', text: custom.text || item.text };
  };

  const answer = (id, value) => {
    if (!id || state.answers[id] || !question(id)) return;
    state.answers[id] = text(value).slice(0, 160);
  };

  const notePains = (line) => {
    for (const pain of PAIN_POINTS) {
      if (!pain.roles.includes(state.role) || state.pains.includes(pain.id)) continue;
      if (pain.pattern.test(line)) state.pains.push(pain.id);
    }
  };

  const heard = (transcript) => {
    const line = text(transcript);
    if (!line) return;
    state.callerTurns += 1;
    state.callerWords += line.split(' ').length;
    state.ack = '';
    if (!fixedClient && !state.roleKnown) {
      const hint = ROLE_HINTS.find((item) => item.pattern.test(line));
      if (hint) {
        state.role = hint.role;
        state.roleKnown = true;
      }
    }
    const before = new Set(Object.keys(state.answers));
    if (state.role === 'client' && OWNS_PLACE.test(line)) {
      state.possibleSeller = true;
      if (!state.answers.goal) answer('goal', `may sell or rent a place they own: ${line}`);
    }
    if (state.pending) {
      const pendingId = state.pending;
      if (state.answers[pendingId]) {
        state.pending = '';
      } else if (realAnswer(question(pendingId), line)) {
        answer(pendingId, line);
        state.ack = question(pendingId)?.reply || '';
        state.pending = '';
      }
    }
    const lower = line.toLowerCase();
    for (const item of pipeline().questions) {
      if (state.answers[item.id] || item.id === 'close') continue;
      const phrase = answerPhrases(question(item.id)?.answers).find((entry) => lower.includes(entry));
      if (phrase) answer(item.id, phrase);
    }
    for (const item of pipeline().questions) {
      if (state.answers[item.id] || !item.heard) continue;
      const match = line.match(item.heard);
      if (match) answer(item.id, match[0]);
    }
    if (!state.ack && !ASKING_BACK.test(line)) {
      const fresh = Object.keys(state.answers).find((id) => !before.has(id) && !(id === 'goal' && state.possibleSeller));
      if (fresh) state.ack = question(fresh)?.reply || '';
    }
    if (/\b(stop calling|don'?t call (me|again)|do not call|remove me|take me off)\b/i.test(line)) state.doNotCall = true;
    notePains(line);
  };

  const said = (raviLine) => {
    const line = text(raviLine);
    if (!line) return;
    const asking = /[?؟]/.test(line);
    let found = '';
    if (asking) {
      for (const item of pipeline().questions) {
        if (item.ask.test(line)) found = item.id;
      }
      const closerAsked = Object.values(CLOSERS).some((closer) => line.toLowerCase().includes(closer.toLowerCase().slice(0, 40)));
      if (!found && !closerAsked) {
        const ids = state.offered ? [state.offered, ...pipeline().questions.map((item) => item.id).filter((id) => id !== state.offered)] : pipeline().questions.map((item) => item.id);
        found = ids.find((id) => !state.answers[id] && sharesContentWord(line, question(id)?.text)) || '';
      }
    }
    if (found) {
      state.pending = state.answers[found] ? '' : found;
      if (!state.asked.includes(found)) state.asked.push(found);
    }
    state.offered = '';
    if (/\b(sign ?up link|signup|demo|summary email|send you (a|the) (link|summary))\b/i.test(line)) state.nextOffered = true;
    for (const [id, closer] of Object.entries(CLOSERS)) {
      if (!state.closers.includes(id) && line.toLowerCase().includes(closer.toLowerCase().slice(0, 40))) state.closers.push(id);
    }
  };

  const answeredCount = () => Object.keys(state.answers).length;
  const qualified = () => {
    const opening = pipeline().opening.filter((id) => state.answers[id]).length;
    return (opening >= 3 && state.pains.length > 0) || answeredCount() >= 5;
  };
  const meaningful = () => state.callerTurns >= 3 && state.callerWords >= 15;

  const nextIds = () => {
    const open = (id) => !state.answers[id] && !state.asked.includes(id) && question(id);
    const ids = [];
    for (const painId of [...state.pains].reverse()) {
      const pain = PAIN_POINTS.find((item) => item.id === painId);
      for (const id of pain?.follow || []) if (open(id) && !ids.includes(id)) ids.push(id);
    }
    for (const id of pipeline().opening) if (open(id) && !ids.includes(id)) ids.push(id);
    for (const item of pipeline().questions) if (item.id !== 'close' && open(item.id) && !ids.includes(item.id)) ids.push(item.id);
    return ids.slice(0, 2);
  };

  const readyToRecommend = () => !state.pitched && state.callerTurns >= 3
    && ((qualified() && state.callerTurns >= 4) || (answeredCount() >= 4 && state.pains.length > 0) || answeredCount() >= 6);

  const closer = () => {
    for (const painId of state.pains) {
      const id = PAIN_CLOSER[painId];
      if (id && !state.closers.includes(id)) return CLOSERS[id];
    }
    return '';
  };

  const cue = () => {
    const p = pipeline();
    const parts = [`Sales pipeline (${state.roleKnown ? p.label : 'role not known yet'}).`];
    if (!state.roleKnown) parts.push('First learn whether they are a realtor, a mortgage broker, or a real estate lawyer.');
    const known = Object.entries(state.answers).slice(-5).map(([id, value]) => `${id}: "${short(value)}"`);
    parts.push(known.length ? `Already known, never ask again: ${known.join('; ')}.` : 'Nothing is known yet.');
    if (state.ack) parts.push(`They just answered your question. Open with a short warm acknowledgement in your own words, like: "${state.ack}"`);
    else if (ASKING_BACK.test(state.lastCaller || '')) parts.push('They asked you something. Answer it directly first; no acknowledgement of an answer.');
    if (state.possibleSeller && !state.sellerAsked) {
      state.sellerAsked = true;
      parts.push('They mentioned a property they own. Find out whether they want to sell it, rent it out, or buy another place.');
    }
    const audience = siteAudience(state.role, state.pains);
    if (state.pains.length) {
      const lines = state.pains.slice(-2).map((id) => {
        const pain = PAIN_POINTS.find((item) => item.id === id);
        const feature = featureForPain(audience, id);
        return `${pain.label} -> ${pain.connect[state.role] || Object.values(pain.connect)[0]}${feature ? ` (Nesti website feature: ${feature.title})` : ''}`;
      });
      parts.push(`Their challenges: ${lines.join('; ')}. Connect the latest one to their situation in one sentence.`);
    }
    const faq = state.lastCaller && ASKING_BACK.test(state.lastCaller) ? text(faqAnswer?.(audience, state.lastCaller)) : '';
    if (faq) parts.push(`What Nesti says about this question (answer from it in one or two short spoken sentences, in your own words): "${faq}"`);
    const why = asksWhyNesti(state.lastCaller);
    if (why && !state.roleKnown) {
      state.offered = '';
      parts.push('They asked why they need Nesti. First ask one short question: are they a realtor, a mortgage broker, or a real estate lawyer? Then answer for that role.');
    } else if (why) {
      state.offered = '';
      const picks = pickSiteFeatures(audience, { pains: state.pains, questions: Object.keys(state.answers) }).map((item) => `${item.title} (${item.description})`);
      const plan = state.pitched || state.outcome === 'declined' ? null : recommendPlan(state.role, state.pains, state.answers);
      parts.push(`They asked why they need Nesti. Answer in two short sentences with these features from the Nesti website, tied to what they told you: ${picks.join('; ')}.${plan ? ` Then name the ${plan.name} plan with its monthly price from the plan facts, and ask if they would like to start it or see a demo.` : ' Do not pitch a plan again.'}`);
    } else if (state.pitched) {
      state.offered = '';
      parts.push(state.nextStep || state.nextOffered
        ? 'A plan was already named; do not pitch again. If they are curious, give the short example.'
        : 'A plan was already named; do not pitch again. Before the call wraps up, offer one next step once: the signup link, a demo with the Nesti team, or a summary email if they agree.');
    } else if (readyToRecommend()) {
      state.offered = '';
      const plan = recommendPlan(state.role, state.pains, state.answers);
      if (plan) parts.push(`If it fits this reply, recommend ${plan.name} (${(plan.adds?.length ? plan.adds : plan.features).slice(0, 4).join(', ')}) and say why it fits their challenge; price as in the plan facts. Then you may ask: "${CLOSERS.subscribe}"`);
    } else {
      const ids = nextIds();
      state.offered = ids[0] || '';
      const next = ids.map((id) => question(id).text);
      if (next.length) parts.push(`Answer them first. Then ask at most one question, in your own words and only if it fits: "${next.join('" or "')}"`);
      const line = closer();
      if (line && answeredCount() >= 3) parts.push(`Or, once, this question: "${line}"`);
    }
    if (/\b(how (does|would) (it|that|this) work|show me|example|demo)\b/i.test(state.lastCaller || '')) parts.push(`Example you can say: ${p.demo}`);
    return parts.join(' ');
  };

  return {
    state,
    heard: (line) => {
      state.lastCaller = text(line);
      heard(line);
    },
    said,
    cue,
    notePitch: () => {
      state.pitched = true;
    },
    noteOutcome: ({ outcome, plan, nextStep, followUpConsent } = {}) => {
      if (outcome) state.outcome = text(outcome).toLowerCase();
      if (plan) state.plan = text(plan).slice(0, 80);
      if (nextStep) state.nextStep = text(nextStep).toLowerCase();
      if (nextStep === 'do_not_call') state.doNotCall = true;
      if (followUpConsent === true) state.followUpConsent = true;
    },
    snapshot: () => {
      const plan = recommendPlan(state.role, state.pains, state.answers);
      return {
        role: state.role,
        role_known: state.roleKnown,
        answers: Object.entries(state.answers).map(([id, value]) => ({ id, question: question(id)?.text || id, answer: value })),
        questions_asked: [...state.asked],
        pain_points: state.pains.map((id) => PAIN_POINTS.find((item) => item.id === id)?.label || id),
        plan_fit: state.plan || plan?.name || '',
        outcome: state.outcome,
        next_step: state.nextStep,
        follow_up_consent: state.followUpConsent,
        demo_requested: state.nextStep === 'demo',
        handoff: state.nextStep === 'human_handoff',
        do_not_call: state.doNotCall,
        qualified: qualified(),
        meaningful: meaningful(),
        caller_turns: state.callerTurns,
        updated_at: new Date(),
      };
    },
  };
}

export function pipelineRoleBrief(role) {
  const key = pipelineRole(role);
  const p = PIPELINES[key];
  if (!p) return 'The caller is a professional. First learn whether they are a realtor, a mortgage broker, or a real estate lawyer.';
  const lawyer = key === 'lawyer' ? ' Never give legal advice, and say Nesti does not replace the firm\'s conflict checks or client engagement procedures.' : '';
  return `This is the ${p.label} pipeline. Focus on ${p.approach}.${lawyer}`;
}

export function painConnections(role, labels = []) {
  const key = pipelineRole(role) || 'agent';
  return labels
    .map((label) => PAIN_POINTS.find((item) => item.label === label || item.id === label))
    .filter(Boolean)
    .map((pain) => pain.connect[key] || Object.values(pain.connect)[0]);
}

export function planPriceText(role, planName) {
  const list = pipelineRole(role) === 'client' ? CLIENT_PLANS : BILLING_PLANS;
  const plan = Object.values(list).find((item) => text(item?.name).toLowerCase() === text(planName).toLowerCase());
  return plan?.display_amount ? `${plan.display_amount} USD a month` : '';
}

export function professionalPlansBrief() {
  const lines = [];
  PLAN_ORDER.forEach((key, index) => {
    const plan = BILLING_PLANS[key];
    if (!plan) return;
    const below = index ? professionalPlanFeatures(PLAN_ORDER[index - 1]) : [];
    const adds = professionalPlanFeatures(key).filter((item) => !below.includes(item));
    lines.push(index ? `${plan.name} adds ${adds.join(', ')}` : `${plan.name}: ${adds.join(', ')}, ${leadLimitNote(key)}`);
  });
  return lines.join('. ');
}
