import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import { buildLeadConversionPack } from '../conversion/buildLeadConversionPack.js';
import {
  getBuyerPropertyMatches,
  getBuyerMatchesForSellerProperty,
} from '../agent/propertyMatch/matchService.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { buildPaginationMeta } from '../../utils/pagination.js';
import { buildCollectionEmptyState } from './leadExperienceContract.js';

export function professionalSummaryFromUser(user = {}) {
  const first = String(user?.first_name || '').trim();
  const last = String(user?.last_name || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ').trim() || null;
  return {
    id: user?._id ? String(user._id) : null,
    name: fullName,
    email: user?.email || null,
    role: user?.role || null,
    is_verified: user?.is_verified ?? null,
  };
}

function pickMatchedLeadForResponse(ml) {
  if (!ml || typeof ml !== 'object') return null;
  const out = {
    intent: ml.intent ?? null,
    preferred_contact_method: ml.preferred_contact_method ?? null,
    best_time_to_contact: ml.best_time_to_contact ?? null,
    property_location: ml.property_location ?? null,
    property_budget: ml.property_budget ?? null,
    property_timeline: ml.property_timeline ?? null,
    property_type: ml.property_type ?? null,
    bedrooms: ml.bedrooms ?? null,
    bathrooms: ml.bathrooms ?? null,
    mortgage_status: ml.mortgage_status ?? null,
    realtor_status: ml.realtor_status ?? null,
    motivation_reason: ml.motivation_reason ?? null,
    viewing_readiness: ml.viewing_readiness ?? null,
    living_situation: ml.living_situation ?? null,
    urgency_readiness: ml.urgency_readiness ?? null,
  };
  const has = Object.values(out).some((v) => v != null && v !== '');
  return has ? out : null;
}

function mergeRowIntoMatchedLead(match = {}) {
  const base = match.matched_lead && typeof match.matched_lead === 'object' ? { ...match.matched_lead } : {};
  if (!base.property_location && match.location) base.property_location = match.location;
  if (!base.property_type && match.property_type) base.property_type = match.property_type;
  if ((base.bedrooms == null || base.bedrooms === '') && match.bedrooms != null && match.bedrooms !== '') {
    base.bedrooms = String(match.bedrooms);
  }
  if ((base.bathrooms == null || base.bathrooms === '') && match.bathrooms != null && match.bathrooms !== '') {
    base.bathrooms = String(match.bathrooms);
  }
  if (!base.property_budget) {
    if (match.budget_display) base.property_budget = match.budget_display;
    else if (match.price != null && match.price !== '') base.property_budget = String(match.price);
  }
  if (!base.mortgage_status && match.financing_status_code) base.mortgage_status = match.financing_status_code;
  return pickMatchedLeadForResponse(base);
}

export function enrichPropertyMatch(match = {}) {
  const factors = Array.isArray(match?.reasons_for_matching) && match.reasons_for_matching.length
    ? match.reasons_for_matching.filter(Boolean)
    : Array.isArray(match?.match_reasons)
      ? match.match_reasons.filter(Boolean)
      : [];
  const mc = match.matched_contact && typeof match.matched_contact === 'object' ? match.matched_contact : null;
  const mergedLead = mergeRowIntoMatchedLead(match);
  return {
    id: match?.id || null,
    title: match?.title || null,
    match_score: match?.match_score ?? null,
    match_headline: match?.match_headline || null,
    source: match?.source || null,
    reasons_for_matching: factors,
    matched_contact: mc
      ? {
          full_name: mc.full_name || mc.fullName || null,
          email: mc.email || null,
          phone: mc.phone || null,
        }
      : null,
    matched_lead: mergedLead,
    lead_profile_id:
      match?.lead_profile_id ||
      (String(match?.id || '').startsWith('lead:') ? String(match.id).slice(5) : null),
  };
}

export async function buildLeadPropertyMatchesPayload({ user, leadMatch, page, limit, skip }) {
  if (!leadMatch.lead_profile_id) {
    return {
      property_matches: [],
      property_matches_context: null,
      conversion: null,
      message: 'No lead profile attached to this lead yet.',
      empty_state: {
        reason: 'Property matching requires a lead profile.',
        action: 'Complete lead qualification fields (intent, budget, location, timeline) to enable matches.',
      },
    };
  }

  const leadProfile = await LeadProfile.findById(leadMatch.lead_profile_id).lean();
  if (!leadProfile) {
    return {
      property_matches: [],
      property_matches_context: null,
      conversion: null,
      message: 'Lead profile not found.',
      empty_state: {
        reason: 'Lead profile data is missing for this lead.',
        action: 'Re-run qualification or reconnect this lead to a valid profile.',
      },
    };
  }

  const prof =
    leadProfile?.ownership?.professional_type ||
    leadMatch?.compatibility_factors?.professional_type ||
    PROFESSIONAL_TYPE.AGENT;

  const conversation = leadMatch.conversation_id
    ? await ChatConversation.findById(leadMatch.conversation_id)
        .select('calendly_booking_status lead_reasons last_interaction_at intent')
        .lean()
    : null;

  let property_matches = [];
  let context = 'buy';
  if (prof === PROFESSIONAL_TYPE.AGENT) {
    const isBuyer = /buy/i.test(leadProfile.intent || leadMatch.lead_type || '');
    context = isBuyer ? 'buy' : 'sell';
    property_matches = isBuyer
      ? await getBuyerPropertyMatches({ userId: user._id, leadProfile, signals: {} })
      : await getBuyerMatchesForSellerProperty({ userId: user._id, leadProfile, signals: {} });
  }

  const conversion = buildLeadConversionPack({
    leadMatch,
    leadProfile,
    conversation,
    ...(prof === PROFESSIONAL_TYPE.AGENT ? { intent: context } : {}),
  });

  const matchesPaginated = property_matches.slice(skip, skip + limit).map(enrichPropertyMatch);

  return {
    lead_id: String(leadMatch._id),
    user_name: professionalSummaryFromUser(user)?.name || null,
    property_matches: matchesPaginated,
    match_count: property_matches.length,
    next_steps: {
      primary_action: {
        id: conversion?.primary_action?.id || null,
        title: conversion?.primary_action?.title || null,
        channel: conversion?.primary_action?.channel || null,
        suggested_first_message: conversion?.primary_action?.follow_up_template || null,
      },
      secondary_actions: Array.isArray(conversion?.secondary_actions)
        ? conversion.secondary_actions.map((a) => ({
            id: a?.id || null,
            title: a?.title || null,
            priority: a?.priority || null,
          }))
        : [],
      booking_cta: conversion?.outcome?.booking_cta || null,
    },
    empty_state:
      property_matches.length === 0 && prof === PROFESSIONAL_TYPE.AGENT
        ? buildCollectionEmptyState('property_matches', { intent: context })
        : null,
    pagination: buildPaginationMeta({ page, limit, total: property_matches.length }),
  };
}
