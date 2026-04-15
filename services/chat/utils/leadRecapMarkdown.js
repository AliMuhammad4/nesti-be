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
  return t.replace(/_/g, ' ');
}

function isMdBulletLine(line) {
  return /^\s*(?:-\s+|\*\s+|•\s+)/.test(String(line || ''));
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
    start !== -1 ||
    /(everything\s+correct|change\s+any\s+details|is\s+everything\s+correct)/i.test(raw) ||
    /\b(here'?s|here is)\b.*\b(so far|gathered|recap)\b/i.test(raw) ||
    /\bwhat\s+i\s+(have|'?ve)\s+so\s+far\b/i.test(raw);

  if (!looksLikeRecap) return raw;

  const mid = recapLines.join('\n');

  if (start !== -1) {
    const before = lines.slice(0, start).join('\n');
    const after = lines.slice(end + 1).join('\n');
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
      return `${intro}\n\n${mid}\n\n${last}`;
    }
  }

  return `${t}\n\n${mid}`;
}
