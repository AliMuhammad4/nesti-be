function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function urgencyWindowLabel(minsOrPreview) {
  const mins =
    typeof minsOrPreview === 'number'
      ? minsOrPreview
      : minsOrPreview?.recommended_response_within_minutes ?? null;
  return formatResponseWindow(mins);
}

function formatResponseWindow(mins) {
  const value = Number(mins);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 60) return `${Math.round(value)} min`;
  const hours = value / 60;
  if (Number.isInteger(hours)) return `${hours} hr`;
  return `${Number(hours.toFixed(1))} hr`;
}

export function buildSpeedToLeadTip(gradeOrPreview, preview) {
  let mins, urgency;
  if (preview !== undefined) {
    mins = preview?.recommended_response_within_minutes;
    urgency = preview?.urgency;
  } else {
    mins = gradeOrPreview?.recommended_response_within_minutes;
    urgency = gradeOrPreview?.urgency;
  }
  const windowLabel = formatResponseWindow(mins);
  if (urgency === 'immediate') return `Hot lead — respond within ${windowLabel || '5 min'} to maximise conversion.`;
  if (urgency === 'same_day') return `Warm lead — follow up within ${windowLabel || '30 min'} while interest is high.`;
  if (windowLabel) return `Reach out within ${windowLabel} for best results.`;
  return null;
}

export function severityFromConversionPreview(preview) {
  const lvl = preview?.alert?.level;
  if (lvl === 'critical') return 'critical';
  if (lvl === 'high') return 'high';
  return 'info';
}

export function conversionPreviewBody(conversion_preview) {
  return (
    conversion_preview?.why_match_one_liner ||
    conversion_preview?.why_one_liner ||
    conversion_preview?.headline ||
    'A new lead was captured from chat.'
  );
}

export function primaryNextActionFromPreview(conversion_preview) {
  if (!conversion_preview?.primary_next_action_id) return null;
  return {
    id: conversion_preview.primary_next_action_id,
    title: conversion_preview.primary_next_action_title,
    follow_up_template: conversion_preview.primary_follow_up_template ?? null,
  };
}

export function buildLeadTrust({ contact = {}, property = {}, qualification = {}, icpFit = null } = {}) {
  const requiredChecks = {
    full_name: isPresent(contact.full_name),
    email_or_phone: isPresent(contact.email) || isPresent(contact.phone),
    intent: isPresent(property.intent),
    location_or_address: isPresent(property.location) || isPresent(property.address),
    budget_or_price: isPresent(property.budget),
    timeline: isPresent(property.timeline),
  };

  const missing_required_fields = Object.keys(requiredChecks).filter((k) => !requiredChecks[k]);
  const known = Object.keys(requiredChecks).length - missing_required_fields.length;
  const completeness_ratio = Number((known / Math.max(Object.keys(requiredChecks).length, 1)).toFixed(2));

  let confidence = 'low';
  if (completeness_ratio >= 0.85) confidence = 'high';
  else if (completeness_ratio >= 0.6) confidence = 'medium';

  const trust_notes = [];
  if (!isPresent(icpFit?.fit_tier))
    trust_notes.push('ICP fit is unavailable; configure ICP profile for stronger explainability.');
  if (missing_required_fields.length)
    trust_notes.push(`Missing key fields: ${missing_required_fields.join(', ')}.`);

  return { confidence, completeness_ratio, missing_required_fields, trust_notes };
}

export function buildDecisionSupport(conversion, grade, specificFacts = []) {
  if (!conversion) {
    return { why_this_match: null, specific_facts: [], match_signals: [], do_this_now: null, urgency: null };
  }

  const windowMins = conversion.speed?.recommended_first_response_minutes ?? null;
  const urgency = conversion.speed?.urgency || null;
  const callRecommended =
    conversion.primary_action?.channel === 'phone' || conversion.primary_action?.id === 'call_now';

  const facts = Array.isArray(specificFacts) ? specificFacts.filter(Boolean) : [];
  if (!facts.length) {
    if (conversion?.signals?.[0]) facts.push(`Lead signal: ${conversion.signals[0]}`);
    else if (windowMins != null) facts.push(`Recommended response window: ${windowMins} min`);
    else facts.push('Collect budget, timeline, and contact preference to sharpen this match explanation.');
  }

  return {
    why_this_match: conversion.why_one_liner || conversion.headline || null,
    specific_facts: facts.slice(0, 4),
    match_signals: Array.isArray(conversion.signals) ? conversion.signals.slice(0, 3) : [],
    do_this_now: conversion.primary_action
      ? {
          id: conversion.primary_action.id,
          title: conversion.primary_action.title,
          channel: conversion.primary_action.channel || null,
          suggested_first_message: conversion.primary_action.follow_up_template || null,
          follow_up_timing_minutes: windowMins,
          call_recommended: !!callRecommended,
        }
      : null,
    urgency: {
      level: conversion.alert?.level || null,
      hot_lead: String(grade || '').toLowerCase() === 'hot' || urgency === 'immediate',
      time_sensitive: urgency === 'immediate' || conversion.speed?.within_sla === false,
      response_window_minutes: windowMins,
      booking_cta: conversion.outcome?.booking_cta || null,
    },
  };
}

export function buildFunnelTelemetry(conversion) {
  return {
    stage: conversion?.outcome?.primary_outcome || null,
    appointment_status: conversion?.speed?.appointment_status || null,
    urgency: conversion?.speed?.urgency || null,
    response_window_minutes: conversion?.speed?.recommended_first_response_minutes ?? null,
    sla_at_risk: conversion?.speed?.within_sla === false,
  };
}

export function buildCollectionEmptyState(kind, context = {}) {
  if (kind === 'notifications') {
    return {
      reason: 'No notifications yet.',
      action: 'As new leads or lifecycle events happen, action alerts will appear here.',
    };
  }
  if (kind === 'leads') {
    return {
      reason: 'No leads match your current filters.',
      action: 'Clear filters or broaden intent/grade to find more opportunities.',
      suggested_filter_reset: true,
    };
  }
  if (kind === 'profile_leads') {
    return {
      reason: 'No leads are linked to this profile yet.',
      action: 'Continue the chat flow or import leads to attach new matches to this profile.',
    };
  }
  if (kind === 'property_matches') {
    const side = context.intent === 'sell' ? 'buyer pipeline leads' : 'seller listings';
    return {
      reason: `No ${side} currently match this lead profile.`,
      action:
        context.intent === 'sell'
          ? 'Update listing details and run matching again.'
          : 'Adjust budget/location/features and retry to surface more listings.',
    };
  }
  return null;
}
