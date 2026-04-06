import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

function normPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function dedupeContactForSummary(contact) {
  if (!contact || typeof contact !== 'object') return contact;
  const c = { ...contact };
  const email = String(c.email || '').trim().toLowerCase();
  const canonEmail = String(c.canonical_email || '').trim().toLowerCase();
  if (canonEmail && email && canonEmail === email) delete c.canonical_email;
  const ph = normPhoneDigits(c.phone);
  const cph = normPhoneDigits(c.canonical_phone);
  if (ph && cph && ph === cph) delete c.canonical_phone;
  return c;
}

function hasStructuredBudgetRange(bp) {
  const min = bp?.min_budget;
  const max = bp?.max_budget;
  return (
    min != null &&
    max != null &&
    Number.isFinite(Number(min)) &&
    Number.isFinite(Number(max))
  );
}

export function mapLeadProfileForApi(profile, profType) {
  const p = profile || {};
  return {
    intent: p.intent || null,
    contact: {
      full_name: p.identity?.full_name || null,
      email: p.identity?.email || null,
      phone: p.identity?.phone || null,
      canonical_email: p.identity?.canonical_email || null,
      canonical_phone: p.identity?.canonical_phone || null,
      preferred_contact_method: p.contact_preferences?.preferred_contact_method || null,
      best_time_to_contact: p.contact_preferences?.best_time_to_contact || null,
    },
    property: {
      location: p.property?.location || null,
      address: p.property?.address || null,
      budget: p.property?.budget || p.property?.expected_price || p.budget_profile?.latest_budget_text || null,
      timeline: p.property?.timeline || p.qualification?.mortgage_broker?.mortgage_timeline || null,
      bedrooms: p.property?.bedrooms || null,
      bathrooms: p.property?.bathrooms || null,
      square_footage: p.property?.square_footage || null,
      property_type: p.property?.property_type || null,
      must_have_features: p.property?.must_have_features || null,
      parking_required: p.property?.parking_required || null,
      backyard_needed: p.property?.backyard_needed || null,
      school_district_important: p.property?.school_district_important || null,
    },
    qualification:
      profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER
        ? {
            mortgage_timeline: p.qualification?.mortgage_broker?.mortgage_timeline || null,
            pre_approval_status:
              p.qualification?.mortgage_broker?.pre_approval_status ||
              p.qualification?.mortgage_broker?.mortgage_status ||
              null,
            credit_score_range: p.qualification?.mortgage_broker?.credit_score_range || null,
            employment_status: p.qualification?.mortgage_broker?.employment_status || null,
            household_income: p.qualification?.mortgage_broker?.household_income || null,
            down_payment_readiness: p.qualification?.mortgage_broker?.down_payment_readiness || null,
            purchase_purpose: p.qualification?.mortgage_broker?.purchase_purpose || null,
            urgency_signal: p.qualification?.mortgage_broker?.urgency_signal || null,
          }
        : profType === PROFESSIONAL_TYPE.LAWYER
          ? {
              transaction_stage: p.qualification?.lawyer?.transaction_stage || null,
              closing_timeline: p.qualification?.lawyer?.closing_timeline || null,
              transaction_type: p.qualification?.lawyer?.transaction_type || null,
              property_value: p.qualification?.lawyer?.property_value || null,
              mortgage_status: p.qualification?.lawyer?.mortgage_status || null,
              realtor_involved: p.qualification?.lawyer?.realtor_involved || null,
              first_time_buyer: p.qualification?.lawyer?.first_time_buyer || null,
              legal_services_needed: p.qualification?.lawyer?.legal_services_needed || null,
            }
          : {
              mortgage_status: p.qualification?.agent?.mortgage_status || null,
              realtor_status: p.qualification?.agent?.realtor_status || null,
              motivation_reason: p.qualification?.agent?.motivation_reason || null,
              viewing_readiness: p.qualification?.agent?.viewing_readiness || null,
              living_situation: p.qualification?.agent?.living_situation || null,
              urgency_readiness: p.qualification?.agent?.urgency_readiness || null,
            },
  };
}

export function formatLeadProfileSummary(profile, options = {}) {
  const { appointment_status: appointmentStatusOpt } = options;
  const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile, profType);
  const ownership = profile.ownership || {};
  const { professional_type: _omitProfType, ...ownershipRest } = ownership;

  const rawBp = profile.budget_profile || {};
  const propBudgetStr = String(profileView.property?.budget || '').trim();
  const latestText = String(rawBp.latest_budget_text || '').trim();
  const budget_profile = { ...rawBp };
  if (latestText && propBudgetStr && latestText === propBudgetStr) {
    delete budget_profile.latest_budget_text;
  }

  const property = { ...profileView.property };
  if (hasStructuredBudgetRange(budget_profile)) {
    delete property.budget;
  }

  const intent = profile.intent || null;
  let intent_summary = { ...(profile.intent_summary || {}) };
  if (intent != null && String(intent_summary.primary_intent || '') === String(intent)) {
    const { primary_intent: _pi, ...isRest } = intent_summary;
    intent_summary = isRest;
  }

  const stats = { ...(profile.stats || {}) };
  let lifecycle = { ...(profile.lifecycle || {}) };
  try {
    const sLast = stats.last_seen_at != null ? new Date(stats.last_seen_at).toISOString() : null;
    const lLast = lifecycle.last_seen_at != null ? new Date(lifecycle.last_seen_at).toISOString() : null;
    if (sLast && lLast && sLast === lLast) {
      delete lifecycle.last_seen_at;
    }
  } catch {
  }

  const out = {
    id: String(profile._id),
    professional_type: profType,
    intent,
    contact: dedupeContactForSummary(profileView.contact),
    property,
    qualification: profileView.qualification,
    ownership: ownershipRest,
    lifecycle,
    ...(Object.keys(intent_summary).length ? { intent_summary } : {}),
    ...(Object.keys(budget_profile).length ? { budget_profile } : {}),
    stats,
    lead_refs: profile.lead_refs || [],
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };

  if (appointmentStatusOpt != null) {
    out.appointment_status = appointmentStatusOpt;
  }

  return out;
}
