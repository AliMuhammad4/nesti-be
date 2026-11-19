import {
  accountStatusFromSubscription,
  hasPaidProfessionalAccess,
} from './subscriptionShared.js';

export { accountStatusFromSubscription } from './subscriptionShared.js';

export const ACCOUNT_STATUS = Object.freeze({
  FREE_TRIAL: 'free_trial',
  EXPIRED: 'expired',
  SUBSCRIBED: 'subscribed',
});

export const SUBSCRIPTION_PLAN = Object.freeze({
  BASIC: 'basic',
  STANDARD: 'standard',
  ENTERPRISE: 'enterprise',
});

export const FEATURES = Object.freeze({
  SETTINGS_SUBSCRIPTION: 'settings.subscription',
  CHATBOT_BASIC: 'chatbot.basic',
  LEADS_CAPTURE: 'leads.capture',
  LEADS_QUESTIONNAIRES: 'leads.questionnaires',
  LEADS_SCORING: 'leads.scoring',
  LEADS_CLASSIFICATION: 'leads.classification',
  CRM_BASIC_LIST: 'crm.basic.list',
  CRM_BASIC_STATUS: 'crm.basic.status',
  CRM_FOLLOWUP_MANUAL: 'crm.followup.manual',
  CRM_LEAD_CONVERSATION: 'crm.lead.conversation',
  PUBLIC_PROFILE: 'public_profile.basic',
  CHATBOT_EMOTIONAL: 'chatbot.emotional',
  CHATBOT_EMOTIONAL_QA: 'chatbot.emotional.qa',
  CHATBOT_EMOTIONAL_TONE: 'chatbot.emotional.emotion_tone',
  CALENDAR_INTEGRATION: 'calendar.integration',
  CALENDAR_VIRTUAL_CONSULT: 'calendar.virtual_consultations',
  LEADS_FOLLOWUP_AUTOMATED: 'leads.followup.automated',
  DASHBOARD_ANALYTICS: 'dashboard.analytics',
  WORKSPACE_ANALYTICS_PAGE: 'workspace.analytics.page',
  REPORTS_AI_MONTHLY: 'reports.ai_monthly',
  ASSISTANT_PROFESSIONAL: 'assistant.professional',
  ASSISTANT_PROFESSIONAL_CLOSING: 'assistant.professional.closing',
  ASSISTANT_PROFESSIONAL_FOLLOWUP: 'assistant.professional.followup',
  LEADS_INSIGHTS_ADVANCED: 'leads.insights.advanced',
  REFERRALS_MANUAL: 'referrals.manual',
  REFERRALS_INVITES: 'referrals.invites',
  PROFILE_ANALYTICS: 'profile.analytics',
  PRO_CHAT: 'prochat.messaging',
  PRO_CHAT_DM: 'prochat.dm',
  VOICE_AGENT: 'voice.agent',
  CALL_HISTORY: 'voice.call_history',
});


export const TRIAL_STUDIO_FEATURES = new Set([
  FEATURES.ASSISTANT_PROFESSIONAL,
  FEATURES.ASSISTANT_PROFESSIONAL_CLOSING,
  FEATURES.ASSISTANT_PROFESSIONAL_FOLLOWUP,
]);

export const BASIC_FEATURES = new Set([
  FEATURES.CHATBOT_BASIC,
  FEATURES.LEADS_CAPTURE,
  FEATURES.LEADS_QUESTIONNAIRES,
  FEATURES.LEADS_SCORING,
  FEATURES.LEADS_CLASSIFICATION,
  FEATURES.CRM_BASIC_LIST,
  FEATURES.CRM_BASIC_STATUS,
  FEATURES.CRM_FOLLOWUP_MANUAL,
  FEATURES.REFERRALS_MANUAL,
  FEATURES.PRO_CHAT_DM,
  FEATURES.DASHBOARD_ANALYTICS,
]);

export const STANDARD_FEATURES = new Set([
  ...BASIC_FEATURES,
  FEATURES.CHATBOT_EMOTIONAL,
  FEATURES.CHATBOT_EMOTIONAL_QA,
  FEATURES.CHATBOT_EMOTIONAL_TONE,
  FEATURES.CALENDAR_INTEGRATION,
  FEATURES.CALENDAR_VIRTUAL_CONSULT,
  FEATURES.LEADS_FOLLOWUP_AUTOMATED,
  FEATURES.ASSISTANT_PROFESSIONAL,
  FEATURES.ASSISTANT_PROFESSIONAL_CLOSING,
  FEATURES.ASSISTANT_PROFESSIONAL_FOLLOWUP,
  FEATURES.CRM_LEAD_CONVERSATION,
  FEATURES.PUBLIC_PROFILE,
  FEATURES.WORKSPACE_ANALYTICS_PAGE,
  FEATURES.REPORTS_AI_MONTHLY,
  FEATURES.LEADS_INSIGHTS_ADVANCED,
  FEATURES.REFERRALS_INVITES,
  FEATURES.PROFILE_ANALYTICS,
  FEATURES.PRO_CHAT,
]);

export const ENTERPRISE_FEATURES = new Set([
  ...STANDARD_FEATURES,
  FEATURES.VOICE_AGENT,
  FEATURES.CALL_HISTORY,
]);

const PLAN_FEATURES = Object.freeze({
  [SUBSCRIPTION_PLAN.BASIC]: BASIC_FEATURES,
  [SUBSCRIPTION_PLAN.STANDARD]: STANDARD_FEATURES,
  [SUBSCRIPTION_PLAN.ENTERPRISE]: ENTERPRISE_FEATURES,
});

export const PLAN_LIMITS = Object.freeze({
  [SUBSCRIPTION_PLAN.BASIC]: Object.freeze({
    chatbot_conversations: 200,
    captured_leads: 150,
    ai_actions: null,
    followup_actions: null,
    referral_analytics: 0,
  }),
  [SUBSCRIPTION_PLAN.STANDARD]: Object.freeze({
    chatbot_conversations: 1000,
    captured_leads: null,
    ai_actions: null,
    followup_actions: null,
    referral_analytics: 100,
  }),
  [SUBSCRIPTION_PLAN.ENTERPRISE]: Object.freeze({
    chatbot_conversations: null,
    captured_leads: null,
    ai_actions: null,
    followup_actions: null,
    referral_analytics: null,
  }),
});

const FREE_TRIAL_LIMIT_OVERRIDES = Object.freeze({});

export function getEffectivePlan(subscription) {
  const planKey = String(subscription?.plan_key || '').trim().toLowerCase();
  if (PLAN_FEATURES[planKey]) return planKey;
  return SUBSCRIPTION_PLAN.BASIC;
}

export function canPublishWebsite(subscription) {
  if (!hasPaidProfessionalAccess(subscription)) return false;
  const plan = getEffectivePlan(subscription);
  return plan === SUBSCRIPTION_PLAN.STANDARD || plan === SUBSCRIPTION_PLAN.ENTERPRISE;
}

export function canRunVoiceAgent(subscription) {
  if (!hasPaidProfessionalAccess(subscription)) return false;
  return getEffectivePlan(subscription) === SUBSCRIPTION_PLAN.ENTERPRISE;
}

export function hasFeature(subscription, featureKey) {
  const feature = String(featureKey || '').trim();
  if (!feature) return false;
  if (feature === FEATURES.SETTINGS_SUBSCRIPTION) return true;
  // The free web page (public profile + free storefront templates) stays available to every
  // approved professional, including after the trial ends or a plan lapses. A subscription row
  // exists only after credential approval. Publishing and paid templates keep their own checks.
  if (feature === FEATURES.PUBLIC_PROFILE) return Boolean(subscription);

  const accountStatus = accountStatusFromSubscription(subscription);
  if (accountStatus === ACCOUNT_STATUS.EXPIRED) return false;

  // Free trial includes RAVI studio even though the trial row is stored as Basic.
  // Paid Basic stays on the embed link only. Voice stays off until a paid Enterprise plan.
  if (accountStatus === ACCOUNT_STATUS.FREE_TRIAL && TRIAL_STUDIO_FEATURES.has(feature)) {
    return true;
  }

  const planKey = getEffectivePlan(subscription);
  return Boolean(PLAN_FEATURES[planKey]?.has(feature));
}

export function getPlanLimits(planKey) {
  const key = String(planKey || '').trim().toLowerCase();
  return PLAN_LIMITS[key] || PLAN_LIMITS[SUBSCRIPTION_PLAN.BASIC];
}

export function getPlanLimitsForSubscription(subscription) {
  const planKey = getEffectivePlan(subscription);
  const baseLimits = getPlanLimits(planKey);
  if (accountStatusFromSubscription(subscription) !== ACCOUNT_STATUS.FREE_TRIAL) {
    return baseLimits;
  }
  return Object.freeze({
    ...baseLimits,
    ...FREE_TRIAL_LIMIT_OVERRIDES,
  });
}
