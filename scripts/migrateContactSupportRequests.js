import 'dotenv/config';
import mongoose from 'mongoose';
import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import ProfessionalSupportRequest from '../models/ProfessionalSupportRequest.js';
import { deleteOwnedLeadMatch } from '../services/lead/leadMatchFollowUpSync.js';
import { supportTopicFromPayload } from '../services/supportRequest/supportRequestService.js';
import { TERMINAL_MATCH_STATUSES } from '../utils/leadMatchStatus.js';

const APPLY = process.argv.includes('--apply');
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const ONLY_IDS = idsArg
  ? idsArg.slice(6).split(',').map((s) => s.trim()).filter((s) => mongoose.Types.ObjectId.isValid(s))
  : null;
const BATCH = 200;

const has = (v) => String(v ?? '').trim() !== '';

/** True when the lead profile has none of the answers the storefront inquiry popup asks for. */
function looksLikeContactPage(professionalType, profile) {
  const property = profile?.property || {};
  const q = profile?.qualification || {};
  if (professionalType === 'lawyer') {
    const l = q.lawyer || {};
    return !has(l.transaction_stage) && !has(l.closing_timeline) && !has(l.transaction_type);
  }
  if (professionalType === 'mortgage_broker') {
    const b = q.mortgage_broker || {};
    return !has(b.mortgage_timeline) && !has(b.pre_approval_status) && !has(b.credit_score_range);
  }
  return !has(property.timeline) && !has(property.budget) && !has(property.expected_price) && !has(property.property_type);
}

function topicFor(professionalType, match, profile) {
  const q = profile?.qualification || {};
  const sideInvestor = /_investor$/.test(String(match.lead_type || ''));
  return supportTopicFromPayload(professionalType, {
    legal_services_needed: q.lawyer?.legal_services_needed,
    purchase_purpose: q.mortgage_broker?.purchase_purpose,
    intent: match.compatibility_factors?.inquiry_intent || profile?.intent,
    client_type: sideInvestor ? 'investor' : '',
  });
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(APPLY ? 'APPLY: moving leads to support requests.' : 'DRY RUN: nothing is written. Add --apply to save.');
  if (ONLY_IDS) console.log(`Only these lead ids: ${ONLY_IDS.join(', ') || '(none valid)'}`);

  const counts = { checked: 0, moved: 0, skipped: 0 };
  let lastId = null;
  for (;;) {
    const filter = {
      'compatibility_factors.source': 'public_web_form',
      'compatibility_factors.inquired_property': { $in: [null] },
      conversation_id: { $in: [null] },
    };
    const idFilter = {
      ...(ONLY_IDS ? { $in: ONLY_IDS.map((id) => new mongoose.Types.ObjectId(id)) } : {}),
      ...(lastId ? { $gt: lastId } : {}),
    };
    if (Object.keys(idFilter).length) filter._id = idFilter;
    const batch = await LeadMatch.find(filter).sort({ _id: 1 }).limit(BATCH).lean();
    if (!batch.length) break;
    lastId = batch[batch.length - 1]._id;

    const profileIds = [...new Set(batch.map((m) => String(m.lead_profile_id || '')).filter(Boolean))];
    const profiles = await LeadProfile.find({ _id: { $in: profileIds } }).lean();
    const byId = new Map(profiles.map((p) => [String(p._id), p]));

    for (const match of batch) {
      counts.checked += 1;
      const factors = match.compatibility_factors || {};
      const profile = byId.get(String(match.lead_profile_id || ''));
      const professionalType = String(factors.professional_type || profile?.ownership?.professional_type || 'agent');
      const message = String(factors.inquiry_message || '').trim();
      const name = profile?.identity?.full_name || '';
      if (!message || (!ONLY_IDS && !looksLikeContactPage(professionalType, profile))) {
        counts.skipped += 1;
        continue;
      }
      const already = await ProfessionalSupportRequest.findOne({ migrated_from_lead_match_id: match._id }).select('_id').lean();
      const { topic_key: topicKey, topic } = topicFor(professionalType, match, profile);
      console.log(`${match._id}  ${professionalType}  ${name || '(no name)'}  <${profile?.identity?.email || ''}>  "${topic}"  -> support request${already ? ' (already copied)' : ''}`);
      counts.moved += 1;
      if (!APPLY) continue;
      if (!already) {
        await ProfessionalSupportRequest.create({
          user_id: match.user_id,
          professional_profile_id: match.professional_profile_id || null,
          professional_type: professionalType,
          full_name: name,
          email: String(profile?.identity?.email || '').toLowerCase(),
          phone: profile?.identity?.phone || '',
          topic_key: topicKey,
          topic,
          message,
          preferred_contact_method: profile?.contact_preferences?.preferred_contact_method || '',
          best_time_to_contact: profile?.contact_preferences?.best_time_to_contact || '',
          location: profile?.property?.location || profile?.property?.address || '',
          page_source: 'contact_page',
          status: match.match_status === 'new' ? 'new' : TERMINAL_MATCH_STATUSES.has(String(match.match_status)) ? 'closed' : 'open',
          read_at: match.match_status === 'new' ? null : new Date(),
          last_submitted_at: factors.last_inquiry_at || match.createdAt || new Date(),
          migrated_from_lead_match_id: match._id,
          createdAt: match.createdAt,
        });
      }
      await deleteOwnedLeadMatch(match.user_id, match._id, { skipPlanCheck: true });
    }
  }

  console.log(
    `${APPLY ? 'Applied' : 'Dry run'}: checked ${counts.checked}, ` +
      `${APPLY ? 'moved' : 'would move'} ${counts.moved}, kept as leads ${counts.skipped}.`,
  );
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
