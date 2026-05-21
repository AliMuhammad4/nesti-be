import OpenAI from 'openai';
import mongoose from 'mongoose';
import ChatConversation from '../../models/ChatConversation.js';
import ChatMessage from '../../models/ChatMessage.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { buildLeadConversionPack } from '../conversion/buildLeadConversionPack.js';
import { mapLeadProfileForApi } from '../lead/leadProfileFormat.js';
import { buildDecisionSupport, buildLeadTrust, buildFunnelTelemetry } from '../lead/leadExperienceContract.js';
import { getLeadKpiEventsForLead } from '../analytics/leadKpiService.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';

let _openaiClient = null;
function getOpenAI() {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}

const LEAD_INSIGHTS_MODEL = process.env.OPENAI_LEAD_INSIGHTS_MODEL || 'gpt-4o-mini';

const KPI_EVENT_LABELS = {
  lead_created: 'Lead captured',
  lead_viewed: 'Viewed in workspace',
  lead_updated: 'Lead updated',
  appointment_booked: 'Appointment booked',
  appointment_canceled: 'Appointment canceled',
  nurture_email_sent: 'Nurture email sent',
  chat_message: 'Chatbot conversation',
  mortgage_calculator_used: 'Mortgage calculator used',
  property_saved: 'Property saved',
  listing_viewed: 'Listing viewed',
  referral_created: 'Referral initiated',
  message_opened: 'Message opened',
};

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

function resolveLeadType(profile, leadMatch, conversation, professionalType = PROFESSIONAL_TYPE.AGENT) {
  if (professionalType === PROFESSIONAL_TYPE.LAWYER) {
    const q = profile?.qualification?.lawyer || {};
    const tx = norm(q.transaction_type);
    const service = norm(q.legal_services_needed);
    if (service.includes('document_review')) return 'document_review_matter';
    if (service.includes('title_transfer') || tx.includes('title_transfer') || tx.includes('title')) {
      return 'title_transfer_matter';
    }
    if (service.includes('full_closing')) {
      if (tx.includes('home_sale') || tx.includes('sale')) return 'home_sale_closing';
      if (tx.includes('home_purchase') || tx.includes('purchase')) return 'home_purchase_closing';
      return 'closing_matter';
    }
    if (tx.includes('refinance')) return 'refinance_matter';
    if (tx.includes('home_sale') || tx.includes('sale')) return 'home_sale_matter';
    if (tx.includes('home_purchase') || tx.includes('purchase')) return 'home_purchase_matter';
    return 'legal_matter';
  }
  if (professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return 'mortgage_client';
  }
  const intent = profile?.intent || conversation?.intent;
  if (intent === 'sell') return 'seller';
  if (intent === 'buy') return 'buyer';
  const lt = norm(leadMatch?.lead_type || '');
  if (/seller/.test(lt)) return 'seller';
  if (/buyer|client/.test(lt)) return 'buyer';
  if (/renter|rent/.test(lt)) return 'renter';
  if (/invest/.test(lt)) return 'investor';
  const motivation = norm(profile?.qualification?.agent?.motivation_reason);
  if (motivation === 'investment') return 'investor';
  return 'lead';
}

function resolveTimelineUrgency(profile, grade) {
  const timeline = norm(profile?.property?.timeline || profile?.property_requirements?.timeline);
  if (/asap|urgent|immediate|now|this month/.test(timeline)) return 'urgent';
  if (/3.?6|few months|soon/.test(timeline)) return 'medium';
  if (/year|long|browsing|explor/.test(timeline)) return 'exploratory';
  const g = norm(grade);
  if (g === 'hot') return 'urgent';
  if (g === 'warm') return 'medium';
  return 'exploratory';
}

function serializeTimelineEvent(ev) {
  return {
    id: ev.id,
    event_type: ev.event_type,
    label: KPI_EVENT_LABELS[ev.event_type] || ev.event_type?.replace(/_/g, ' ') || 'Activity',
    occurred_at: ev.occurred_at,
    metadata: ev.metadata || null,
  };
}

function extractJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('empty AI response');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('AI response was not JSON');
  }
}

function asString(value, fallback = null, max = 800) {
  const s = String(value ?? '').trim();
  if (!s) return fallback;
  return s.slice(0, max);
}

function asEnum(value, allowed, fallback) {
  const s = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return allowed.includes(s) ? s : fallback;
}

function asStringArray(value, fallback = [], maxItems = 6, maxLen = 220, { required = false } = {}) {
  if (!Array.isArray(value)) {
    if (required) throw new Error('AI response is missing a required list');
    return fallback;
  }
  const items = value
    .map((item) => asString(item, null, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
  return items.length ? items : fallback;
}

function asRiskFlags(value, fallback = []) {
  if (!Array.isArray(value)) throw new Error('AI response is missing risk flags');
  const items = value
    .map((item, idx) => ({
      type: asString(item?.type, `ai_risk_${idx + 1}`, 48),
      label: asString(item?.label, null, 220),
      severity: asEnum(item?.severity, ['low', 'medium', 'high'], 'medium'),
    }))
    .filter((item) => item.label)
    .slice(0, 6);
  return items.length ? items : fallback;
}

function asConversionGuidance(value) {
  const guidance = value && typeof value === 'object' ? value : {};
  return {
    next_steps: asStringArray(guidance.next_steps, [], 5, 220, { required: true }),
    conversion_strategy: asString(guidance.conversion_strategy, null, 420),
    suggested_message: asString(guidance.suggested_message, null, 600),
  };
}

function compactMessages(messages = []) {
  return messages
    .map((m) => ({
      role: m.role,
      content: String(m.content || '').slice(0, 700),
      created_at: m.createdAt || null,
    }))
    .filter((m) => m.content)
    .slice(-12);
}

function normalizeCachedIntelligence(intelligence) {
  if (!intelligence || typeof intelligence !== 'object') return intelligence;
  const { recommended_actions, ...rest } = intelligence;
  return rest;
}

function hasConversionGuidance(intelligence) {
  const guidance = intelligence?.conversion_guidance;
  if (!guidance || typeof guidance !== 'object') return false;
  if (Array.isArray(guidance.next_steps) && guidance.next_steps.some((step) => String(step || '').trim())) {
    return true;
  }
  return Boolean(
    String(guidance.conversion_strategy || '').trim() ||
      String(guidance.suggested_message || '').trim(),
  );
}

function hasCurrentLeadTypeShape(intelligence, professionalType) {
  if (professionalType !== PROFESSIONAL_TYPE.LAWYER) return true;
  const leadType = norm(intelligence?.overview?.lead_type);
  return !['legal_purchase_client', 'legal_sale_client', 'legal_client'].includes(leadType);
}

function sanitizeAiIntelligence(ai, base) {
  if (!ai || typeof ai !== 'object') throw new Error('AI response was not an object');
  const overview = ai.overview && typeof ai.overview === 'object' ? ai.overview : {};
  const personality = ai.personality && typeof ai.personality === 'object' ? ai.personality : {};
  const readiness = ai.readiness && typeof ai.readiness === 'object' ? ai.readiness : {};
  const conversionGuidance = asConversionGuidance(ai.conversion_guidance);

  return normalizeCachedIntelligence({
    ...base,
    overview: {
      ...base.overview,
      summary: asString(overview.summary, null, 800),
    },
    personality: {
      ...base.personality,
      communication_style: asEnum(
        personality.communication_style,
        ['analytical', 'emotional', 'fast_decision_maker', 'cautious', 'balanced'],
        'balanced',
      ),
      decision_making_style: asEnum(
        personality.decision_making_style,
        ['action_oriented', 'researching', 'deliberate', 'collaborative', 'uncertain'],
        'deliberate',
      ),
      emotional_concerns: asStringArray(
        personality.emotional_concerns,
        [],
        5,
        80,
        { required: true },
      ),
      confidence_level: asEnum(
        personality.confidence_level,
        ['low', 'medium', 'high'],
        'medium',
      ),
      engagement_behaviour: asString(
        personality.engagement_behaviour,
        null,
        160,
      ),
      best_way_to_communicate: asStringArray(
        personality.best_way_to_communicate,
        [],
        5,
        260,
        { required: true },
      ),
    },
    readiness: {
      ...base.readiness,
      conversion_likelihood: asEnum(
        readiness.conversion_likelihood,
        ['low', 'medium', 'high'],
        'medium',
      ),
      engagement_level: asEnum(
        readiness.engagement_level,
        ['low', 'medium', 'high'],
        'medium',
      ),
      readiness_stage: asEnum(
        readiness.readiness_stage,
        ['early', 'researching', 'ready_to_act'],
        'researching',
      ),
      follow_up_urgency: asEnum(
        readiness.follow_up_urgency,
        ['low', 'medium', 'high'],
        'medium',
      ),
      insight: asString(readiness.insight, null, 420),
      needs_before_next_step: asString(
        readiness.needs_before_next_step,
        null,
        220,
      ),
    },
    risk_flags: asRiskFlags(ai.risk_flags, []),
    conversion_guidance: conversionGuidance,
    ai_generated: true,
    ai_model: LEAD_INSIGHTS_MODEL,
  });
}

const LEAD_INSIGHTS_SYSTEM_PROMPT = `You are Nesti's senior lead intelligence analyst for real estate professionals.

Generate refined, practical insights for the logged-in professional based ONLY on provided lead_context facts.
Your job is to explain what the lead likely needs, how ready they are, what could block conversion, and what should happen next to convert the lead.

Quality rules:
- Be specific to the lead details, requirements, qualification answers, chat messages, activity timeline, lead score, and conversion pack.
- Do not invent missing facts, names, locations, budgets, approvals, appointments, documents, or outcomes.
- If a detail is missing, frame it as something to clarify, not as a fact.
- Avoid generic sales language like "follow up promptly" unless you add what to ask or send.
- Prefer concise executive-style sentences with clear reasoning.
- Every risk should be grounded in a visible signal from lead_context.
- Conversion guidance must be specific enough that the professional can act on it immediately.

Role language:
- lawyer: use legal client, matter, closing, transaction, documents, retainer, title, or consultation language. Do not call the lead a buyer/seller unless explicitly relevant.
- mortgage_broker: use financing, affordability, pre-approval, income, credit, down payment, and application language.
- agent: use buyer/seller/renter/investor language only when supported by the lead's intent or profile.

Field style:
- overview.summary: 2-3 polished sentences: current situation, readiness, and best commercial angle.
- personality.best_way_to_communicate: concrete communication guidance, not personality labels.
- readiness.insight: explain what must happen to move the lead forward.
- risk_flags.label: include the risk and why it matters.
- conversion_guidance.next_steps: 3-5 concrete steps in order.
- conversion_guidance.conversion_strategy: concise strategy for converting this lead.
- conversion_guidance.suggested_message: one ready-to-send message tailored to this lead; no placeholders unless required data is missing.

Return only JSON matching this shape:
{
  "overview": { "summary": "string" },
  "personality": {
    "communication_style": "analytical|emotional|fast_decision_maker|cautious|balanced",
    "decision_making_style": "action_oriented|researching|deliberate|collaborative|uncertain",
    "emotional_concerns": ["string"],
    "confidence_level": "low|medium|high",
    "engagement_behaviour": "string",
    "best_way_to_communicate": ["string"]
  },
  "readiness": {
    "conversion_likelihood": "low|medium|high",
    "engagement_level": "low|medium|high",
    "readiness_stage": "early|researching|ready_to_act",
    "follow_up_urgency": "low|medium|high",
    "insight": "string",
    "needs_before_next_step": "string|null"
  },
  "risk_flags": [{ "type": "string", "label": "string", "severity": "low|medium|high" }],
  "conversion_guidance": {
    "next_steps": ["string"],
    "conversion_strategy": "string",
    "suggested_message": "string"
  }
}`;

async function generateOpenAiLeadIntelligence({ base, professionalType, leadMatch, profileView, conversation, timeline, conversion }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OpenAI is not configured');
    error.statusCode = 503;
    throw error;
  }

  const messages = conversation?._id
    ? await ChatMessage.find({ conversation_id: conversation._id })
        .sort({ createdAt: -1 })
        .limit(12)
        .lean()
    : [];

  const leadContext = {
    professional_type: professionalType,
    lead: {
      id: leadMatch?._id ? String(leadMatch._id) : null,
      lead_type: leadMatch?.lead_type || null,
      match_status: leadMatch?.match_status || null,
      score: leadMatch?.match_score ?? conversation?.lead_score ?? null,
      grade: leadMatch?.lead_type?.split('_')[0] ?? conversation?.lead_grade ?? null,
      icp_fit: leadMatch?.icp_fit || null,
    },
    profile: profileView,
    conversation: {
      lead_score: conversation?.lead_score ?? null,
      lead_grade: conversation?.lead_grade ?? null,
      lead_classification: conversation?.lead_classification ?? null,
      emotional_state: conversation?.emotional_state ?? null,
      lead_reasons: conversation?.lead_reasons || null,
      messages: compactMessages(messages.reverse()),
    },
    activity_timeline: timeline.slice(-20),
    conversion_pack: conversion,
    current_structured_facts: base,
  };

  const completion = await getOpenAI().chat.completions.create({
    model: LEAD_INSIGHTS_MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.18,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: LEAD_INSIGHTS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Generate lead intelligence JSON from this lead_context:\n${JSON.stringify(leadContext)}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '';
  return sanitizeAiIntelligence(extractJsonObject(raw), base);
}

const getTemperatureLabel = (grade, professionalType) => {
  if (professionalType === PROFESSIONAL_TYPE.LAWYER) {
    return grade === 'hot' ? 'Transaction Ready' : grade === 'warm' ? 'Likely soon' : 'Early stage';
  }
  if (professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return grade === 'hot' ? 'Ready for Mortgage Now' : grade === 'warm' ? 'Likely soon' : 'Early stage';
  }
  return grade === 'hot' ? 'Ready to Act' : grade === 'warm' ? 'Likely soon' : 'Early stage';
};

const buildQualificationData = (profile, professionalType) => {
  if (!profile) return null;
  if (professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return {
      mortgage_timeline: profile.qualification?.mortgage_broker?.mortgage_timeline,
      pre_approval_status:
        profile.qualification?.mortgage_broker?.pre_approval_status ||
        profile.qualification?.mortgage_broker?.mortgage_status,
      credit_score_range: profile.qualification?.mortgage_broker?.credit_score_range,
      employment_status: profile.qualification?.mortgage_broker?.employment_status,
      household_income: profile.qualification?.mortgage_broker?.household_income,
      down_payment_readiness: profile.qualification?.mortgage_broker?.down_payment_readiness,
      purchase_purpose: profile.qualification?.mortgage_broker?.purchase_purpose,
      urgency_signal: profile.qualification?.mortgage_broker?.urgency_signal,
    };
  }
  if (professionalType === PROFESSIONAL_TYPE.LAWYER) {
    return {
      transaction_stage: profile.qualification?.lawyer?.transaction_stage,
      closing_timeline: profile.qualification?.lawyer?.closing_timeline,
      transaction_type: profile.qualification?.lawyer?.transaction_type,
      property_value: profile.qualification?.lawyer?.property_value,
      mortgage_status: profile.qualification?.lawyer?.mortgage_status,
      realtor_involved: profile.qualification?.lawyer?.realtor_involved,
      first_time_buyer: profile.qualification?.lawyer?.first_time_buyer,
      legal_services_needed: profile.qualification?.lawyer?.legal_services_needed,
    };
  }
  return {
    mortgage_status: profile.qualification?.agent?.mortgage_status,
    realtor_status: profile.qualification?.agent?.realtor_status,
    motivation_reason: profile.qualification?.agent?.motivation_reason,
    viewing_readiness: profile.qualification?.agent?.viewing_readiness,
    living_situation: profile.qualification?.agent?.living_situation,
    urgency_readiness: profile.qualification?.agent?.urgency_readiness,
  };
};

/**
 * Unified AI lead intelligence payload (sections A–G) for workspace + API.
 */
export async function buildLeadIntelligence({
  userId,
  leadMatch,
  profile = null,
  conversation = null,
}) {
  if (!leadMatch?._id) return null;

  const professionalType =
    leadMatch?.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile || {}, professionalType);
  const grade = leadMatch?.lead_type?.split('_')[0] ?? conversation?.lead_grade ?? 'unscored';
  const score = Math.round(Number(leadMatch?.match_score ?? conversation?.lead_score ?? 0));
  const conversion = buildLeadConversionPack({
    leadMatch,
    leadProfile: profile && profile._id ? profile : null,
    conversation: conversation && conversation._id ? conversation : null,
  });

  const appointmentStatus = resolveAppointmentStatus(
    leadMatch?.match_status,
    conversation?.calendly_booking_status,
    leadMatch?.compatibility_factors?.calendly?.calendly_event_start || conversation?.calendly_event_start,
  );

  let timelinePayload = { events: [] };
  try {
    timelinePayload = await getLeadKpiEventsForLead(userId, leadMatch._id, { days: 90, limit: 50 });
  } catch {
    timelinePayload = { events: [] };
  }
  const timeline = (timelinePayload.events || []).map(serializeTimelineEvent);
  const baseIntelligence = {
    overview: {
      lead_type: resolveLeadType(profile, leadMatch, conversation, professionalType),
      budget_range: profileView?.property?.budget || null,
      location_preference:
        profileView?.property?.location || profileView?.property?.address || null,
      timeline: resolveTimelineUrgency(profile, grade),
      lead_score: score,
      grade,
      temperature_label: getTemperatureLabel(grade, professionalType),
      appointment_status: appointmentStatus,
    },
    personality: {},
    readiness: {},
    risk_flags: [],
    conversion_guidance: {
      next_steps: [],
      conversion_strategy: null,
      suggested_message: null,
    },
    activity_timeline: timeline,
    generated_at: new Date().toISOString(),
  };

  return generateOpenAiLeadIntelligence({
    base: baseIntelligence,
    professionalType,
    leadMatch,
    profileView,
    conversation,
    timeline,
    conversion,
  });
}

export const getLeadInsights = async ({ userId, conversationId }) => {
  const conversation = await ChatConversation.findOne({
    _id: conversationId,
    user_id: userId,
  }).lean();

  if (!conversation) {
    return { success: false, status: 404, message: 'Conversation not found' };
  }

  const leadMatch = await LeadMatch.findOne({
    conversation_id: conversation._id,
    user_id: userId,
  }).lean();

  const profile = leadMatch?.lead_profile_id
    ? await LeadProfile.findById(leadMatch.lead_profile_id).lean()
    : null;

  const professionalType = leadMatch?.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const leadReasons = conversation.lead_reasons?.lead_reasons || [];
  const subScores = conversation.lead_reasons?.sub_scores || {};
  const score = leadMatch?.match_score ?? conversation.lead_score ?? 0;
  const grade = leadMatch?.lead_type?.split('_')[0] ?? conversation.lead_grade ?? 'unscored';
  const temperatureLabel = getTemperatureLabel(grade, professionalType);

  const insights = [];

  insights.push({
    type: 'summary',
    title: 'Lead Summary',
    data: {
      score,
      grade,
      classification: conversation.lead_classification || null,
      temperature_label: temperatureLabel,
      is_qualified: conversation.is_qualified ?? false,
      professional_type: professionalType,
    },
  });

  if (leadReasons.length) {
    insights.push({
      type: 'reasons',
      title: 'Scoring Factors',
      data: { reasons: leadReasons },
    });
  }

  if (Object.keys(subScores).length) {
    insights.push({
      type: 'sub_scores',
      title: 'Score Breakdown',
      data: subScores,
    });
  }

  const qual = buildQualificationData(profile, professionalType);
  if (qual) {
    insights.push({
      type: 'qualification',
      title: 'Qualification Details',
      data: qual,
    });
  }

  const conversion = leadMatch
    ? buildLeadConversionPack({
        leadMatch,
        leadProfile: profile || null,
        conversation,
      })
    : null;

  const profileView = mapLeadProfileForApi(profile || {}, professionalType);
  const specificFacts = [
    score != null ? `Lead score ${Number(score)}/100` : null,
    profileView?.property?.budget ? `Budget/price: ${profileView.property.budget}` : null,
    profileView?.property?.timeline ? `Timeline: ${profileView.property.timeline}` : null,
    profileView?.property?.location || profileView?.property?.address
      ? `Area: ${profileView.property.location || profileView.property.address}`
      : null,
  ].filter(Boolean);

  const intelligence = leadMatch
    ? await buildLeadIntelligence({ userId, leadMatch, profile, conversation })
    : null;

  return {
    success: true,
    insights,
    intelligence,
    decision_support: buildDecisionSupport(conversion, grade, specificFacts),
    trust: buildLeadTrust({
      contact: profileView?.contact || {},
      property: { ...(profileView?.property || {}), intent: profileView?.intent || null },
      qualification: profileView?.qualification || null,
      icpFit: leadMatch?.icp_fit || null,
    }),
    conversion_funnel: buildFunnelTelemetry(conversion),
    empty_state:
      insights.length === 0
        ? {
            reason: 'No lead insight data is available for this conversation yet.',
            action: 'Continue qualifying the lead to generate explanation and next-action guidance.',
          }
        : null,
  };
};

export const analyzeLeadIntelligence = async ({ userId, leadId, refresh = false }) => {
  if (!leadId || !mongoose.Types.ObjectId.isValid(String(leadId))) {
    return { success: false, status: 400, message: 'Invalid lead id' };
  }

  const leadMatch = await LeadMatch.findOne({
    _id: leadId,
    user_id: userId,
  }).lean();

  if (!leadMatch) {
    return { success: false, status: 404, message: 'Lead not found' };
  }

  const professionalType = leadMatch?.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
  if (
    !refresh &&
    leadMatch.ai_insights?.payload &&
    typeof leadMatch.ai_insights.payload === 'object' &&
    hasConversionGuidance(leadMatch.ai_insights.payload) &&
    hasCurrentLeadTypeShape(leadMatch.ai_insights.payload, professionalType)
  ) {
    return {
      success: true,
      lead_id: String(leadMatch._id),
      conversation_id: leadMatch.conversation_id ? String(leadMatch.conversation_id) : null,
      intelligence: normalizeCachedIntelligence(leadMatch.ai_insights.payload),
      cached: true,
    };
  }

  const [profile, conversation] = await Promise.all([
    leadMatch.lead_profile_id ? LeadProfile.findById(leadMatch.lead_profile_id).lean() : null,
    leadMatch.conversation_id ? ChatConversation.findById(leadMatch.conversation_id).lean() : null,
  ]);

  const intelligence = await buildLeadIntelligence({
    userId,
    leadMatch,
    profile,
    conversation,
  });

  await LeadMatch.updateOne(
    { _id: leadMatch._id, user_id: userId },
    {
      $set: {
        'ai_insights.payload': intelligence,
        'ai_insights.generated_at': new Date(intelligence.generated_at || Date.now()),
        'ai_insights.model': intelligence.ai_model || LEAD_INSIGHTS_MODEL,
      },
    },
  );

  return {
    success: true,
    lead_id: String(leadMatch._id),
    conversation_id: leadMatch.conversation_id ? String(leadMatch.conversation_id) : null,
    intelligence,
    cached: false,
  };
};
