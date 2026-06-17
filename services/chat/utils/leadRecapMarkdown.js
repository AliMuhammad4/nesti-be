/**
 * Server-built lead recap bullets for chat replies (avoids fragile client-side regex hydration).
 */

function trimVal(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

function humanize(v) {
  const t = trimVal(v);
  if (!t) return '';
  const key = t.toLowerCase();
  const mortgageTokenMap = {
    '20_plus': '20%+',
    '10_19': '10-19%',
    '5_9': '5-9%',
    under_5: 'Under 5%',
    no_savings: 'No savings yet',
  };
  if (mortgageTokenMap[key]) return mortgageTokenMap[key];
  return t.replace(/_/g, ' ');
}

function isMdBulletLine(line) {
  return /^\s*(?:-\s+|\*\s+|•\s+)/.test(String(line || ''));
}

function isRecapBulletLine(line) {
  const s = String(line || '').trim();
  if (!isMdBulletLine(s)) return false;
  return /^\s*[-*•]\s+\*\*[^*]+:\*\*/.test(s);
}

function hasHollowRecapBullets(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .some((line) => /^\s*[-*•]\s+\*\*[^*]+:\*\*\s*$/.test(String(line || '')));
}

function blockLooksLikeRecapBullets(lines, start, end) {
  const block = lines.slice(start, end + 1).filter((line) => isMdBulletLine(line));
  if (!block.length) return false;
  return block.every((line) => isRecapBulletLine(line) || /^\s*[-*•]\s+\*\*[^*]+:\*\*\s*$/.test(String(line || '')));
}

function aiReplyHasRecapIntent(raw) {
  const r = String(raw || '').replace(/[’‘]/g, "'");
  return (
    /(everything\s+correct|change\s+any\s+details|is\s+everything\s+correct)/i.test(r) ||
    /\bjust\s+to\s+confirm\b/i.test(r) ||
    /\b(?:to\s+)?recap\b/i.test(r) ||
    /\bquick\s+recap\b/i.test(r) ||
    /\b(here'?s|here is)\b.*\b(so far|gathered|recap|shared)\b/i.test(r) ||
    /\bhere'?s\b.*\bquick\s+recap\b/i.test(r) ||
    /\bwhat\s+i\s+(have|'?ve)\s+so\s+far\b/i.test(r) ||
    /\b(confirm|correct)\b.*\b(details|information|this)\b/i.test(r) ||
    /\b(anything\s+(you'?d\s+)?like\s+to\s+(change|correct)|does\s+this\s+look\s+right|sound\s+right|confirm\s+(these\s+)?details)\b/i.test(
      r,
    )
  );
}

function isFollowupPromptParagraph(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /\?/.test(t) ||
    /\b(confirm|correct|change|preferred|best time|contact|reach out|available)\b/i.test(t)
  );
}

function isContactPreferencePromptParagraph(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /\bhow would you (?:like|prefer)\b.*\bcontact\b/i.test(t) ||
    /\bpreferred\b.*\bcontact\b/i.test(t) ||
    /\bbest time to (?:contact|reach)\b/i.test(t)
  );
}

function isRecapConfirmationPromptParagraph(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /\b(is|does)\s+everything\s+(?:correct|look\s+correct|look\s+right|sound\s+right)\b/i.test(t) ||
    /\bconfirm\b.*\b(correct|details|information|this)\b/i.test(t) ||
    /\bwould you like to change any details\b/i.test(t) ||
    /\b(change|correct)\s+any\s+details\b/i.test(t)
  );
}

function stripContactPreferenceAsk(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  // Remove appended contact-preference ask from recap turns.
  const stripped = t.replace(
    /(?:\s*(?:also|additionally)\s*,?\s*)?(?:how would you (?:like|prefer)[\s\S]*?best time[\s\S]*?)$/i,
    '',
  );
  return stripped.trim();
}

function normalizeRecapFollowupText(text) {
  const parts = String(text || '')
    .split(/\n\s*\n+/)
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (!parts.length) return '';

  const kept = [];
  let hasConfirmationPrompt = false;
  let sawFollowupPrompt = false;

  for (const part of parts) {
    if (isContactPreferencePromptParagraph(part)) continue;
    if (isFollowupPromptParagraph(part)) {
      sawFollowupPrompt = true;
      if (isRecapConfirmationPromptParagraph(part)) {
        hasConfirmationPrompt = true;
        kept.push(part);
      }
      continue;
    }
    kept.push(part);
  }

  if (sawFollowupPrompt && !hasConfirmationPrompt) {
    kept.push('Is everything correct, or would you like to change any details?');
  }
  return kept.join('\n\n');
}

/** @param {string} text */
export function isDetailsConfirmationMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  const exact = new Set([
    'yes',
    'y',
    'yep',
    'yeah',
    'sure',
    'correct',
    'confirmed',
    'looks good',
    'all good',
    'perfect',
    'right',
    'ok',
    'okay',
    'agreed',
    'approved',
    'go ahead',
    'please proceed',
  ]);
  if (exact.has(t)) return true;
  return (
    /details?.*(correct|right|good|fine|ok|okay|perfect|great|accurate)/.test(t) ||
    /(everything|all(\s+the)?\s+details?).*(correct|right|good|fine|ok|okay|perfect|great)/.test(t) ||
    /(looks?|seems?).*(correct|right|good|fine|perfect|great)/.test(t) ||
    /(confirm|confirmed).*(details?|information|info)/.test(t) ||
    /\b(entered\s+)?details?\s+(are|is)\s+(perfect|correct|right|good|fine|accurate)\b/.test(t) ||
    /\b(that'?s|it'?s)\s+(all\s+)?(correct|right|perfect|accurate|good|fine)\b/.test(t) ||
    /\b(all|everything)\s+(is|sounds?|looks?)\s+(correct|good|perfect|fine)\b/.test(t) ||
    /\b(no\s+)?changes?\s+(needed|required)\b/.test(t) ||
    /\b(that'?s|sounds?|looks?)\s+(perfect|great|good)\b/.test(t) ||
    /\b(spot\s+on|exactly|precisely)\b/.test(t)
  );
}

/**
 * Only hydrate lead recap on intake confirmation turns — not general follow-up Q&A.
 *
 * @param {object} opts
 * @param {string} [opts.userMessage]
 * @param {string} [opts.aiReply]
 * @param {number} [opts.interactionCount] user messages in conversation so far
 */
export function shouldHydrateLeadRecap({ userMessage, aiReply, interactionCount }) {
  // Run recap hydration pass on every turn; `injectLeadRecapIntoReply` stays a no-op
  // unless the assistant reply actually looks like a recap.
  void userMessage;
  void aiReply;
  void interactionCount;
  return true;
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} [opts.form] merged form_data / formContact
 * @param {Record<string, unknown>} [opts.contact] accumulated contact
 * @param {Record<string, unknown>} [opts.extracted] AI META `details`
 * @param {string} [opts.intent]
 * @returns {string[]} lines like `- **Label:** value`
 */
export function buildLeadRecapMarkdownLines({ form = {}, contact = {}, extracted = {}, intent: intentRaw = '' }) {
  const intent = String(intentRaw || form.intent || '').toLowerCase();
  const isSell = intent === 'sell';

  const name = trimVal(contact.name || form.name);
  const email = trimVal(contact.email || form.email);
  const phone = trimVal(contact.phone || form.phone);
  const location = trimVal(
    form.location || form.address || contact.address || extracted.property_address,
  );
  const budgetOrPrice = isSell
    ? trimVal(form.price || extracted.budget || form.budget)
    : trimVal(form.budget || extracted.budget || form.price);
  const propertyType = trimVal(form.property_type || extracted.property_type);
  const beds = trimVal(form.beds ?? form.bedrooms ?? extracted.bedrooms);
  const baths = trimVal(form.baths ?? form.bathrooms ?? extracted.bathrooms);
  const mustHave = trimVal(form.must_have_features || extracted.must_have_features);
  const timeline = humanize(form.timeline || extracted.timeline);
  const mortgage = humanize(form.mortgage_status || extracted.mortgage_status);
  const realtor = humanize(form.realtor_status || extracted.realtor_status);
  const motivation = humanize(form.motivation_reason || extracted.motivation_reason);
  const viewing = humanize(form.viewing_readiness || extracted.viewing_readiness);
  const living = humanize(form.living_situation || extracted.living_situation);
  const urgency = humanize(form.urgency_readiness || extracted.urgency_readiness);

  /** @type {string[]} */
  const rows = [];
  const add = (label, val) => {
    const t = trimVal(val);
    if (!t) return;
    rows.push(`- **${label}:** ${t}`);
  };

  add('Name', name);
  add('Email', email);
  add('Phone', phone);
  add(isSell ? 'Property address' : 'Location', location);
  add(isSell ? 'Expected selling price' : 'Budget', budgetOrPrice);
  add('Property type', propertyType);
  add(isSell ? 'Bedrooms' : 'Bedrooms required', beds);
  add(isSell ? 'Bathrooms' : 'Bathrooms required', baths);
  add('Must-have features', mustHave);
  add('Timeline', timeline);
  add('Mortgage status', mortgage);
  add('Realtor status', realtor);
  add('Reason for move', motivation);
  add('Viewing readiness', viewing);
  add('Living situation', living);
  add('Ready to make an offer', urgency);

  const proType = String(form.professionalType || '').toLowerCase();
  if (proType === 'lawyer' || trimVal(form.transaction_stage) || trimVal(form.legal_services_needed)) {
    add('Transaction stage', humanize(form.transaction_stage || extracted.transaction_stage));
    add('Closing timeline', humanize(form.closing_timeline || extracted.closing_timeline));
    add('Transaction type', humanize(form.transaction_type || extracted.transaction_type));
    add('Property value', humanize(form.property_value || extracted.property_value));
    add('Legal services needed', humanize(form.legal_services_needed || extracted.legal_services_needed));
    add('Realtor involved', humanize(form.realtor_involved || extracted.realtor_involved));
    add('First-time buyer', humanize(form.first_time_buyer || extracted.first_time_buyer));
    add('Preferred contact', humanize(form.preferred_contact_method || extracted.preferred_contact_method));
    add('Best time to contact', humanize(form.best_time_to_contact || extracted.best_time_to_contact));
  }
  if (
    proType === 'mortgage_broker' ||
    trimVal(form.mortgage_timeline) ||
    trimVal(form.pre_approval_status)
  ) {
    add('Apply timeline', humanize(form.mortgage_timeline || extracted.mortgage_timeline));
    add('Pre-approval status', humanize(form.pre_approval_status || extracted.pre_approval_status));
    add('Credit range', humanize(form.credit_score_range || extracted.credit_score_range));
    add('Employment', humanize(form.employment_status || extracted.employment_status));
    add('Household income', humanize(form.household_income || extracted.household_income));
    add('Down payment readiness', humanize(form.down_payment_readiness || extracted.down_payment_readiness));
    add('Purchase purpose', humanize(form.purchase_purpose || extracted.purchase_purpose));
    add('Preferred contact', humanize(form.preferred_contact_method || extracted.preferred_contact_method));
    add('Best time to contact', humanize(form.best_time_to_contact || extracted.best_time_to_contact));
  }

  return rows;
}

/**
 * When the model emits a recap (bullets and/or confirmation copy), replace hollow bullets
 * or insert server-filled bullets before the closing question.
 *
 * @param {string} reply
 * @param {string[]} recapLines
 * @returns {string}
 */
export function injectLeadRecapIntoReply(reply, recapLines) {
  if (!recapLines?.length) return String(reply || '');
  const raw = String(reply || '');
  const lines = raw.split(/\r?\n/);

  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isMdBulletLine(line)) {
      if (start === -1) start = i;
      end = i;
    } else if (start !== -1) {
      if (String(line).trim() === '') {
        let j = i + 1;
        while (j < lines.length && String(lines[j]).trim() === '') j++;
        if (j < lines.length && isMdBulletLine(lines[j])) continue;
      }
      break;
    }
  }

  const looksLikeRecap =
    hasHollowRecapBullets(raw) ||
    (start !== -1 && blockLooksLikeRecapBullets(lines, start, end)) ||
    aiReplyHasRecapIntent(raw);

  if (!looksLikeRecap) return raw;

  const mid = recapLines.join('\n');

  if (start !== -1 && blockLooksLikeRecapBullets(lines, start, end)) {
    const before = lines.slice(0, start).join('\n');
    const after = normalizeRecapFollowupText(lines.slice(end + 1).join('\n'));
    return [before, mid, after].filter((s) => trimVal(s)).join('\n\n');
  }

  const t = raw.trim();
  const parts = t.split(/\n\s*\n+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (
      /(everything\s+correct|change\s+any|details\s+correct)/i.test(last) ||
      /\b(confirm|correct|change)\b/i.test(last)
    ) {
      const intro = parts.slice(0, -1).join('\n\n');
      const cleanedLast = stripContactPreferenceAsk(last);
      const finalLast =
        cleanedLast && cleanedLast.length > 0
          ? cleanedLast
          : 'Is everything correct, or would you like to change any details?';
      if (aiReplyHasRecapIntent(intro)) {
        return `Here's what you've shared so far:\n\n${mid}\n\n${finalLast}`;
      }
      return `${intro}\n\n${mid}\n\n${finalLast}`;
    }
  }

  // If model already wrote a prose recap, replace that block with structured recap
  // and preserve only follow-up prompt paragraphs to avoid duplicate recaps.
  if (parts.length >= 2) {
    const tail = [];
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (!isFollowupPromptParagraph(parts[i])) break;
      if (isContactPreferencePromptParagraph(parts[i])) continue;
      if (isRecapConfirmationPromptParagraph(parts[i])) {
        tail.unshift(parts[i]);
      }
    }
    const confirmationTail =
      tail.length > 0 ? tail : ['Is everything correct, or would you like to change any details?'];
    return [`Here's what you've shared so far:`, mid, ...confirmationTail].join('\n\n');
  }

  return `${t}\n\n${mid}`;
}
