import ChatConversation from '../../models/ChatConversation.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

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

const buildNextSteps = (grade, profile, professionalType) => {
  const steps = [];
  if (grade === 'hot') {
    if (professionalType === PROFESSIONAL_TYPE.LAWYER) {
      steps.push('Schedule consultation immediately — client is transaction-ready');
      steps.push('Send closing checklist and documents needed');
    } else if (professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
      steps.push('Schedule a call immediately — lead is ready for mortgage');
      steps.push('Send pre-approval application link');
    } else {
      steps.push('Schedule viewing or call immediately');
    }
  } else if (grade === 'warm') {
    steps.push('Follow up within 1–2 days with next steps');
    steps.push(professionalType === PROFESSIONAL_TYPE.LAWYER ? 'Share educational content on closing process' : 'Share educational content');
  } else {
    steps.push('Add to nurture sequence');
    steps.push('Re-engage when timeline or readiness improves');
  }
  if (profile?.contact_preferences?.preferred_contact_method) {
    steps.push(`Preferred contact: ${profile.contact_preferences.preferred_contact_method}`);
  }
  if (profile?.contact_preferences?.best_time_to_contact) {
    steps.push(`Best time: ${profile.contact_preferences.best_time_to_contact}`);
  }
  return steps;
};

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

  const nextSteps = buildNextSteps(grade, profile, professionalType);
  insights.push({
    type: 'next_steps',
    title: 'Recommended Actions',
    data: { actions: nextSteps },
  });

  return { success: true, insights };
};
