import { icpFactorNarrative, icpTierHeadline } from './icpDimensionLabels.js';
function normalizeReasons(conversation) {
  const lr = conversation?.lead_reasons;
  const raw = lr && typeof lr === 'object' ? lr.lead_reasons : lr;
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean).slice(0, 8);
  }
  return [];
}
function gradeIntentHeadline(grade, intent) {
  const g = String(grade || 'warm').toLowerCase();
  const i = String(intent || 'buy').toLowerCase();
  if (i === 'unspecified') {
    if (g === 'hot') return 'High-intent lead — prioritize outreach';
    if (g === 'warm') return 'Engaged lead — confirm needs and book next step';
    return 'Early-stage lead — nurture with light, helpful follow-up';
  }
  if (g === 'hot') {
    return i === 'sell' ? 'High-intent seller — prioritize outreach' : 'High-intent buyer — prioritize outreach';
  }
  if (g === 'warm') {
    return i === 'sell' ? 'Engaged seller — confirm motivation and timeline' : 'Engaged buyer — qualify and book next step';
  }
  return 'Early-stage lead — nurture with light, helpful follow-up';
}
function buildWhyStrongMatch({ grade, intent, tier, score, strengths, signalBullets }) {
  const g = String(grade || '').toLowerCase();
  const i = String(intent || 'buy').toLowerCase();
  const tierLabel = tier ? String(tier).replace(/_/g, ' ') : null;
  let one_liner = '';
  if (i === 'unspecified') {
    if (tier === 'perfect_match' && (g === 'hot' || g === 'warm')) {
      one_liner = `Strong ideal-client fit${score != null ? ` (${score}/100)` : ''} plus ${g === 'hot' ? 'high' : 'solid'} engagement — treat as a priority conversation, not a nurture-only lead.`;
    } else if (tier === 'good_match' && (g === 'hot' || g === 'warm')) {
      one_liner = `Good ICP alignment with clear engagement — confirm the one or two gaps below, then move to a booked call.`;
    } else if (g === 'hot') {
      one_liner =
        'High-intent lead — respond fast and steer toward a concrete next step (call or consultation).';
    } else if (g === 'warm') {
      one_liner =
        'Engaged lead — qualify quickly and offer times before interest cools.';
    } else if (signalBullets.length) {
      one_liner = 'Signals from the chat support continued qualification; lead with relevance to what they already shared.';
    } else if (tier === 'low_match') {
      one_liner = 'Weaker ICP match — still worth a light triage: one message to confirm fit before investing deep time.';
    } else {
      one_liner = 'Early-stage — lead with helpful education and a soft ask for a short call when timing feels right.';
    }
    const actionable_takeawaysUnspec = [];
    if (signalBullets[0]) {
      actionable_takeawaysUnspec.push(`Reference in outreach: “${signalBullets[0].slice(0, 120)}${signalBullets[0].length > 120 ? '…' : ''}”`);
    }
    for (const s of strengths.slice(0, 2)) {
      actionable_takeawaysUnspec.push(`Lean on ${s.title.toLowerCase()}: ${s.detail}`);
    }
    if (!actionable_takeawaysUnspec.length && tierLabel && score != null) {
      actionable_takeawaysUnspec.push(`Use ICP fit (${score}/100, ${tierLabel}) to open: explain why you are a strong fit for their situation.`);
    }
    if (actionable_takeawaysUnspec.length < 2 && (g === 'hot' || g === 'warm')) {
      actionable_takeawaysUnspec.push('Lead with one calendar or phone offer in the first touch — avoid long questionnaires.');
    }
    return {
      one_liner,
      actionable_takeaways: actionable_takeawaysUnspec.slice(0, 4),
    };
  }
  if (tier === 'perfect_match' && (g === 'hot' || g === 'warm')) {
    one_liner = `Strong ideal-client fit${score != null ? ` (${score}/100)` : ''} plus ${g === 'hot' ? 'high' : 'solid'} intent — treat as a priority conversation, not a nurture-only lead.`;
  } else if (tier === 'good_match' && (g === 'hot' || g === 'warm')) {
    one_liner = `Good ICP alignment with clear engagement — confirm the one or two gaps below, then move to a booked call.`;
  } else if (g === 'hot') {
    one_liner =
      i === 'sell'
        ? 'High-intent seller — speed and a clear listing path matter more than perfect data completeness.'
        : 'High-intent buyer — respond fast and steer toward a concrete next step (call or showing).';
  } else if (g === 'warm') {
    one_liner = `Engaged ${i === 'sell' ? 'seller' : 'buyer'} — your job is to qualify quickly and offer times before interest cools.`;
  } else if (signalBullets.length) {
    one_liner = 'Signals from the chat support continued qualification; lead with relevance to what they already shared.';
  } else if (tier === 'low_match') {
    one_liner = 'Weaker ICP match — still worth a light triage: one message to confirm fit before investing deep time.';
  } else {
    one_liner = 'Early-stage — lead with helpful education and a soft ask for a short call when timing feels right.';
  }
  const actionable_takeaways = [];
  if (signalBullets[0]) {
    actionable_takeaways.push(`Reference in outreach: “${signalBullets[0].slice(0, 120)}${signalBullets[0].length > 120 ? '…' : ''}”`);
  }
  for (const s of strengths.slice(0, 2)) {
    actionable_takeaways.push(`Lean on ${s.title.toLowerCase()}: ${s.detail}`);
  }
  if (!actionable_takeaways.length && tierLabel && score != null) {
    actionable_takeaways.push(`Use ICP fit (${score}/100, ${tierLabel}) to open: explain why you are a strong fit for their situation.`);
  }
  if (actionable_takeaways.length < 2 && (g === 'hot' || g === 'warm')) {
    actionable_takeaways.push('Lead with one calendar or phone offer in the first touch — avoid long questionnaires.');
  }

  return {
    one_liner,
    actionable_takeaways: actionable_takeaways.slice(0, 4),
  };
}
export function buildMatchStory({ leadMatch, conversation, intent }) {
  const grade = String(leadMatch?.lead_type || '').split('_')[0] || 'warm';
  const icp = leadMatch?.icp_fit && typeof leadMatch.icp_fit === 'object' ? leadMatch.icp_fit : null;
  const tier = icp?.fit_tier || null;
  const score = icp?.fit_score != null ? Number(icp.fit_score) : null;
  const matched = Array.isArray(icp?.matched_factors) ? icp.matched_factors : [];
  const missing = Array.isArray(icp?.missing_factors) ? icp.missing_factors : [];
  const strengths = matched.map((dim) => icpFactorNarrative(dim, true));
  const gaps = missing.map((dim) => icpFactorNarrative(dim, false));
  const signalBullets = normalizeReasons(conversation);
  const why_strong_match = buildWhyStrongMatch({
    grade,
    intent,
    tier,
    score,
    strengths,
    signalBullets,
  });

  let headline = gradeIntentHeadline(grade, intent);
  let icpHeadline = null;
  if (tier) {
    icpHeadline = icpTierHeadline(tier);
    headline = `${headline} · ${icpHeadline}`;
  }

  const narrativeParts = [];
  if (score != null && tier) {
    narrativeParts.push(`ICP fit score ${score}/100 (${String(tier).replace(/_/g, ' ')}).`);
  }
  if (strengths.length) {
    narrativeParts.push(
      `Strongest alignment: ${strengths
        .slice(0, 3)
        .map((s) => s.title.toLowerCase())
        .join(', ')}.`,
  );
  } else if (!icp) {
    narrativeParts.push('Configure ICP on your profile to see structured fit strengths and gaps.');
  }

  return {
    headline,
    why_strong_match,
    narrative: narrativeParts.join(' '),
    signal_bullets: signalBullets,
    icp_alignment:
      icp && (matched.length || missing.length || score != null)
        ? {
            tier,
            score,
            tier_headline: tier ? icpTierHeadline(tier) : null,
            strengths,
            gaps,
          }
        : null,
    lead_quality: {
      grade,
      score: leadMatch?.match_score != null ? Number(leadMatch.match_score) : null,
    },
  };
}
