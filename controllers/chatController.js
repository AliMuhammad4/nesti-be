import { handleChatService } from '../services/chatService.js';
import { scoreLead, scoreMortgageBrokerLead, scoreLawyerLead } from '../services/chat/scoring/index.js';

export const handleChat = async (req, res, next) => {
  try {
    const { id, message, embedToken, visitorId, agentType, channel, formContact } = req.body;

    // Capture request metadata for attribution
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
      formContact,   // structured contact from the frontend form (name, email, phone)
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

/** Score preview from form data (no chat session required) */
export const scorePreview = async (req, res, next) => {
  try {
    const formContact = req.body.formContact || req.body;
    const professionalType = req.body.professionalType || formContact.professionalType || 'agent';
    const isMortgageBroker = professionalType === 'mortgage_broker';
    const isLawyer = professionalType === 'lawyer';
    const intent = formContact.intent || 'buy';

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
    });
  } catch (error) {
    next(error);
  }
};
