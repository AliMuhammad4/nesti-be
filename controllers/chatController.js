import {
  handleChatService,
  handlePropertyMatchesService,
  clearChatSessionService,
  selectChatPropertyMatchService,
} from '../services/chat/chatService.js';
import { buildMortgageAffordabilitySnapshot } from '../services/chat/mortgageBroker/mortgageAffordabilityFromLead.js';
import { scoreLead, scoreMortgageBrokerLead, scoreLawyerLead } from '../services/chat/scoring/index.js';
import { PROFESSIONAL_TYPE } from '../constants/roles.js';
import logger from '../utils/logger.js';

function maskEmbedToken(token) {
  if (token == null || typeof token !== 'string') return null;
  const t = token.trim();
  if (!t) return null;
  if (t.length <= 8) return '***';
  return `…${t.slice(-6)}`;
}

function hasChatContact(meta) {
  const c = meta?.contact;
  if (!c || typeof c !== 'object') return false;
  return Boolean(c.email || c.phone || c.name);
}

export const handleChat = async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { id, message, embedToken, visitorId, agentType, channel, formContact } = req.body;

    logger.info('Chat API: request', {
      op:           'chat.message',
      session_id:   id || null,
      embed_token:  maskEmbedToken(embedToken),
      visitor_id:   visitorId || null,
      agent_type:   agentType || null,
      channel:      channel || null,
      message_len:  typeof message === 'string' ? message.length : 0,
    });

    const clientIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      '';
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.headers['referrer'] || '';

    const result = await handleChatService({
      id,
      message,
      embedToken,
      visitorId,
      agentType,
      channel,
      clientIp,
      userAgent,
      referer,
      formContact,
    });

    const meta = result.body?.meta;
    logger.info('Chat API: response', {
      op:                      'chat.message',
      http_status:             result.status,
      ms:                      Date.now() - startedAt,
      session_id:              result.body?.session_id ?? id ?? null,
      visitor_id:              result.body?.visitor_id ?? visitorId ?? null,
      conversation_id:         meta?.conversation_id ?? null,
      intent:                  meta?.intent ?? null,
      lead_grade:              meta?.lead_grade ?? null,
      lead_score:              meta?.lead_score ?? null,
      is_qualified:            meta?.is_qualified ?? null,
      has_contact:             hasChatContact(meta),
      automated_booking:       meta?.automated_booking_enabled ?? null,
      calendly_booking_status: meta?.calendly_booking_status ?? null,
      calendly_webhook_alignment: meta?.calendly_webhook_alignment ?? null,
      has_calendly_link:       Boolean(meta?.calendly_link),
      property_matches_avail:  meta?.property_matches_available ?? null,
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Chat API: error', {
      op:    'chat.message',
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

export const handlePropertyMatches = async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { id, embedToken, visitorId, formContact, page, limit } = req.body;
    logger.info('Chat API: property-matches request', {
      op:          'chat.property_matches',
      session_id:  id || null,
      embed_token: maskEmbedToken(embedToken),
      visitor_id:  visitorId || null,
    });

    const result = await handlePropertyMatchesService({
      id,
      embedToken,
      visitorId,
      formContact,
      page,
      limit,
    });

    const pm = result.body?.meta?.property_matches;
    const count = Array.isArray(pm) ? pm.length : 0;
    logger.info('Chat API: property-matches response', {
      op:                      'chat.property_matches',
      http_status:             result.status,
      ms:                      Date.now() - startedAt,
      session_id:              result.body?.session_id ?? id ?? null,
      context:                 result.body?.meta?.property_matches_context ?? null,
      match_count:             count,
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Chat API: property-matches error', {
      op:    'chat.property_matches',
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

export const selectPropertyMatch = async (req, res, next) => {
  try {
    const { id, embedToken, property } = req.body;
    const result = await selectChatPropertyMatchService({ id, embedToken, property });
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Chat API: select property match error', {
      op: 'chat.property_match_select',
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

export const scorePreview = async (req, res, next) => {
  try {
    let mortgage_affordability_snapshot = null;
    const formContact = req.body.formContact || req.body;
    const professionalType = req.body.professionalType || formContact.professionalType || PROFESSIONAL_TYPE.AGENT;
    const isMortgageBroker = professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER;
    const isLawyer = professionalType === PROFESSIONAL_TYPE.LAWYER;
    const intent =
      isLawyer || isMortgageBroker ? 'unspecified' : formContact.intent || 'buy';

    const formSignals = isLawyer
      ? {
          timeline: formContact.closing_timeline || formContact.timeline || null,
          budget:   formContact.budget || formContact.property_value || null,
          location: formContact.location || formContact.address || null,
          beds:     null,
          baths:    null,
          area:     null,
        }
      : {
          timeline: formContact.timeline || formContact.mortgage_timeline || null,
          budget:   formContact.budget   || formContact.price || null,
          location: formContact.location || null,
          beds:     formContact.beds  ? (parseInt(formContact.beds, 10)  || null) : null,
          baths:    formContact.baths ? (parseInt(formContact.baths, 10) || null) : null,
          area:     null,
        };

    const hasContact = Boolean(
      formContact.email || formContact.phone || formContact.name
    );

    const contactInfo = {
      name:  formContact.name  || null,
      email: formContact.email || null,
      phone: formContact.phone || null,
    };

    let leadScore, leadGrade, leadMeta;

    if (isLawyer) {
      const formQualification = {
        transaction_stage:     formContact.transaction_stage || null,
        closing_timeline:      formContact.closing_timeline || null,
        transaction_type:     formContact.transaction_type || null,
        property_value:       formContact.property_value || null,
        mortgage_status:     formContact.mortgage_status || null,
        realtor_involved:     formContact.realtor_involved || null,
        first_time_buyer:     formContact.first_time_buyer || null,
        legal_services_needed: formContact.legal_services_needed || null,
      };
      const result = scoreLawyerLead({
        message:          '',
        hasContact,
        contactInfo,
        interactionCount: 0,
        seedSignals:      formSignals,
        formQualification,
      });
      leadScore = result.leadScore;
      leadGrade = result.leadGrade;
      leadMeta = result.leadMeta;
    } else if (isMortgageBroker) {
      const formQualification = {
        mortgage_timeline:      formContact.mortgage_timeline || null,
        pre_approval_status:    formContact.pre_approval_status || null,
        credit_score_range:     formContact.credit_score_range || null,
        employment_status:      formContact.employment_status || null,
        household_income:       formContact.household_income || null,
        down_payment_readiness: formContact.down_payment_readiness || null,
        property_budget:        formContact.property_budget || null,
        purchase_purpose:       formContact.purchase_purpose || null,
        urgency_signal:         formContact.urgency_signal || null,
        budget:                 formContact.budget || null,
      };
      const result = scoreMortgageBrokerLead({
        message:          '',
        hasContact,
        contactInfo,
        interactionCount: 0,
        seedSignals:      formSignals,
        formQualification,
      });
      leadScore = result.leadScore;
      leadGrade = result.leadGrade;
      leadMeta = result.leadMeta;
      mortgage_affordability_snapshot = buildMortgageAffordabilitySnapshot(formQualification, formSignals, leadGrade);
    } else {
      const formQualification = {
        mortgage_status:    formContact.mortgage_status || null,
        realtor_status:     formContact.realtor_status || null,
        motivation_reason:  formContact.motivation_reason || null,
        viewing_readiness:  formContact.viewing_readiness || null,
        living_situation:   formContact.living_situation || null,
        urgency_readiness:  formContact.urgency_readiness || null,
      };
      const parts = [];
      if (formContact.location) parts.push(`interested in ${formContact.location}`);
      if (formContact.budget)  parts.push(`budget ${formContact.budget}`);
      if (formContact.timeline) parts.push(`timeline ${formContact.timeline}`);
      if (formContact.mortgage_status) parts.push(`mortgage ${formContact.mortgage_status.replace(/_/g, ' ')}`);
      if (formContact.realtor_status === 'no_agent') parts.push('no realtor not working with agent');
      else if (formContact.realtor_status === 'has_agent_but_open') parts.push('have realtor but open to others');
      else if (formContact.realtor_status === 'has_exclusive_agent') parts.push('have a realtor working with agent');
      if (formContact.motivation_reason) parts.push(formContact.motivation_reason.replace(/_/g, ' '));
      if (formContact.viewing_readiness === 'asap') parts.push('start viewing asap');
      else if (formContact.viewing_readiness === 'few_weeks') parts.push('viewing within a few weeks');
      else if (formContact.viewing_readiness === 'maybe_later') parts.push('maybe later');
      else if (formContact.viewing_readiness === 'just_browsing') parts.push('just browsing');
      if (formContact.living_situation === 'renting') parts.push('currently renting');
      else if (formContact.living_situation === 'own_need_to_sell') parts.push('own need to sell');
      else if (formContact.living_situation === 'own_not_selling') parts.push('owns property');
      if (formContact.urgency_readiness === 'yes_immediately') parts.push('ready to make an offer immediately');
      else if (formContact.urgency_readiness === 'maybe') parts.push('might make an offer');
      else if (formContact.urgency_readiness === 'no') parts.push('not ready');
      const syntheticMessage = parts.join(' ');

      const result = scoreLead({
        message:          syntheticMessage,
        hasContact,
        contactInfo,
        interactionCount: 0,
        seedSignals:      formSignals,
        formQualification,
      });
      leadScore = result.leadScore;
      leadGrade = result.leadGrade;
      leadMeta = result.leadMeta;
    }

    const leadClassification = isMortgageBroker
      ? `${leadGrade.charAt(0).toUpperCase() + leadGrade.slice(1)} Mortgage Lead`
      : isLawyer
      ? `${leadGrade.charAt(0).toUpperCase() + leadGrade.slice(1)} Lawyer Lead`
      : `${leadGrade.charAt(0).toUpperCase() + leadGrade.slice(1)} ${intent === 'sell' ? 'Seller' : 'Buyer'}`;

    res.json({
      success: true,
      lead_score:        leadScore,
      lead_grade:        leadGrade,
      lead_classification: leadClassification,
      is_qualified:      leadMeta.qualified,
      lead_reasons:      leadMeta.lead_reasons,
      sub_scores:        leadMeta.sub_scores,
      ...(mortgage_affordability_snapshot ? { mortgage_affordability_snapshot } : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const clearChatSession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await clearChatSessionService(id);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return next(error);
  }
};
