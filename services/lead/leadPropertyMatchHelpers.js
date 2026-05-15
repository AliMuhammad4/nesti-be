import { buildDecisionSupport, buildLeadTrust } from './leadExperienceContract.js';

export function buildPropertyMatchTrust(leadProfile, context) {
  return buildLeadTrust({
    contact: {
      full_name: leadProfile?.identity?.full_name || null,
      email: leadProfile?.identity?.email || null,
      phone: leadProfile?.identity?.phone || null,
    },
    property: {
      intent: leadProfile?.intent || context,
      location: leadProfile?.property?.location || null,
      address: leadProfile?.property?.address || null,
      budget:
        leadProfile?.property?.budget ||
        leadProfile?.property?.expected_price ||
        leadProfile?.budget_profile?.latest_budget_text ||
        null,
      timeline: leadProfile?.property?.timeline || null,
    },
    qualification: leadProfile?.qualification || null,
    icpFit: null,
  });
}

export function buildPropertyMatchDecisionSupport(conversion, leadMatch, leadProfile) {
  return buildDecisionSupport(
    conversion,
    leadMatch.lead_type?.split('_')[0] || null,
    [
      leadMatch?.match_score != null ? `Lead score ${Number(leadMatch.match_score)}/100` : null,
      leadProfile?.property?.budget || leadProfile?.property?.expected_price
        ? `Budget/price: ${leadProfile?.property?.budget || leadProfile?.property?.expected_price}`
        : null,
      leadProfile?.property?.timeline ? `Timeline: ${leadProfile.property.timeline}` : null,
      leadProfile?.property?.location || leadProfile?.property?.address
        ? `Area: ${leadProfile.property.location || leadProfile.property.address}`
        : null,
    ].filter(Boolean),
  );
}
