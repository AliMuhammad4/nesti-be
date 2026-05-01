import mongoose from 'mongoose';
import Referral from '../models/Referral.js';
import LeadMatch from '../models/LeadMatch.js';
import User from '../models/User.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import ChatConversation from '../models/ChatConversation.js';
import LeadProfile from '../models/LeadProfile.js';
import { REFERRAL_STATUSES } from '../constants/validationEnums.js';
import logger from '../utils/logger.js';
import {
  parsePageLimitPagination,
  buildPaginationMeta,
  PAGINATION_PRESETS,
} from '../utils/pagination.js';
import { mapLeadMatchToDetail } from '../services/lead/leadResponseMappers.js';
import { mapLeadProfileForApi } from '../services/lead/leadProfileFormat.js';
import { PROFESSIONAL_TYPE, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';

/** Shape profile/contact/property for API rows by referrer role (not viewer role). */
function displayProfessionalTypeFromRole(roleRaw) {
  const r = String(roleRaw || '').trim().toLowerCase();
  if (r === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (r === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  return PROFESSIONAL_TYPE.AGENT;
}

function userPreview(u) {
  if (!u) return null;
  if (typeof u === 'string') return { id: String(u) };
  const id = u?._id || u?.id;
  if (!id) return null;
  const full = String(
    u?.full_name ||
      [u?.first_name, u?.last_name].filter(Boolean).join(' ') ||
      ''
  ).trim();
  return {
    id: String(id),
    full_name: full || null,
    email: u?.email || null,
    role: u?.role || null,
    profile_image: u?.profile_image || null,
  };
}

function serializeReferral(doc) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o || !o._id) return null;
  const userIdRaw = o.user_id?._id || o.user_id;
  const targetUserIdRaw = o.target_user_id?._id || o.target_user_id;
  return {
    id: String(o._id),
    user_id: userIdRaw ? String(userIdRaw) : '',
    target_user_id: targetUserIdRaw ? String(targetUserIdRaw) : '',
    conversation_id: String(o.conversation_id),
    target_vertical: o.target_vertical,
    status: o.status,
    notes: o.notes ?? '',
    referrer: userPreview(o.user_id),
    target_professional: userPreview(o.target_user_id),
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

/** Infer canonical chat intent from scored lead_type (e.g. hot_buyer → buy). */
function intentFromLeadType(leadType) {
  const t = String(leadType || '').trim().toLowerCase();
  if (/_buyer$/.test(t)) return 'buy';
  if (/_seller$/.test(t)) return 'sell';
  return null;
}

/**
 * Prefer real conversation/profile intent; then intent_summary.primary_intent; then lead_type.
 */
function coerceListIntent(conversation, profile, leadMatch) {
  const isPlaceholder = (v) => {
    const s = String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    return !s || ['unspecified', 'unknown', 'n/a', 'na', 'none'].includes(s);
  };

  const convIntent = conversation?.intent;
  const profileIntent = profile?.intent;

  if (!isPlaceholder(convIntent)) return String(convIntent).trim();
  if (!isPlaceholder(profileIntent)) return String(profileIntent).trim();

  const primary = String(profile?.intent_summary?.primary_intent || '')
    .trim()
    .toLowerCase();
  if (primary === 'buy' || primary === 'sell') return primary;

  const fromLt = intentFromLeadType(leadMatch?.lead_type);
  if (fromLt) return fromLt;

  return null;
}

/**
 * Conversation classification is often still `unclassified`; LeadMatch.lead_type (e.g. interested_buyer)
 * is set during scoring and is a better list fallback for agent rows.
 */
function coerceListLeadCategory(conversation, leadMatch) {
  const raw =
    conversation?.lead_classification != null ? String(conversation.lead_classification).trim() : '';
  const lower = raw.toLowerCase();
  if (raw && lower !== 'unclassified') return raw;

  const lt = String(leadMatch?.lead_type || '')
    .trim()
    .toLowerCase();
  if (!lt || lt === 'unknown') return null;
  return lt
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Table-friendly snapshot for list views (referrer/source lead row). */
function buildListLeadSummary(sourceRoleRaw, profile, conversation, leadMatch) {
  const role = String(sourceRoleRaw || profile?.ownership?.professional_type || 'agent')
    .trim()
    .toLowerCase();

  let scoreRaw = profile?.scoring?.current_score;
  if (scoreRaw === undefined || scoreRaw === null || scoreRaw === '') {
    scoreRaw = conversation?.lead_score;
  }
  if (scoreRaw === undefined || scoreRaw === null || scoreRaw === '') {
    scoreRaw = leadMatch?.match_score;
  }

  let leadScore =
    scoreRaw !== undefined && scoreRaw !== null && scoreRaw !== '' ? Number(scoreRaw) : null;
  if (Number.isNaN(leadScore)) leadScore = null;

  const grade = profile?.scoring?.current_grade || conversation?.lead_grade || null;
  const leadCategory = coerceListLeadCategory(conversation, leadMatch);

  const base = {
    source_role: role,
    lead_score: leadScore,
    lead_grade: grade || null,
    lead_category: leadCategory,
    intent: null,
    property_type: null,
    lawyer: null,
    mortgage: null,
  };

  if (role === 'lawyer') {
    base.intent = coerceListIntent(conversation, profile, leadMatch);
    const lq = profile?.qualification?.lawyer || {};
    base.lawyer = {
      transaction_stage: lq.transaction_stage || '',
      closing_timeline: lq.closing_timeline || '',
      transaction_type: lq.transaction_type || '',
      legal_services_needed: lq.legal_services_needed || '',
    };
  } else if (role === 'mortgage_broker') {
    const mq = profile?.qualification?.mortgage_broker || {};
    base.mortgage = {
      mortgage_timeline: mq.mortgage_timeline || '',
      pre_approval_status: mq.pre_approval_status || '',
    };
    base.intent = coerceListIntent(conversation, profile, leadMatch);
  } else {
    base.intent = coerceListIntent(conversation, profile, leadMatch);
    base.property_type = profile?.property?.property_type || '';
  }

  return base;
}

function pairKeyReferral(userId, conversationId) {
  return `${String(userId)}:${String(conversationId)}`;
}

/**
 * Enrich referral rows for list UIs: batch-load referrer-side LeadMatch, profile, and conversation.
 */
async function mapReferralsListToApiItems(list) {
  if (!Array.isArray(list) || list.length === 0) return [];

  const orConditions = list
    .map((r) => {
      const uid = r.user_id?._id || r.user_id;
      const cid = r.conversation_id;
      if (!uid || !cid) return null;
      return { user_id: uid, conversation_id: cid };
    })
    .filter(Boolean);

  let matches = [];
  if (orConditions.length > 0) {
    matches = await LeadMatch.find({ $or: orConditions })
      .select(
        'user_id conversation_id lead_profile_id match_score match_status compatibility_factors lead_type'
      )
      .lean();
  }

  const matchByPair = new Map();
  for (const m of matches) {
    matchByPair.set(pairKeyReferral(m.user_id, m.conversation_id), m);
  }

  const profileIds = [...new Set(matches.map((m) => m.lead_profile_id).filter(Boolean))];
  const profiles =
    profileIds.length > 0
      ? await LeadProfile.find({ _id: { $in: profileIds } })
          .select('intent intent_summary identity property qualification lifecycle scoring ownership')
          .lean()
      : [];
  const profileById = new Map(profiles.map((p) => [String(p._id), p]));

  const convIds = [...new Set(list.map((r) => r.conversation_id).filter(Boolean))];
  const conversations =
    convIds.length > 0
      ? await ChatConversation.find({ _id: { $in: convIds } })
          .select('intent lead_score lead_grade lead_classification is_qualified emotional_state form_data')
          .lean()
      : [];
  const convById = new Map(conversations.map((c) => [String(c._id), c]));

  const items = [];
  for (const r of list) {
    const base = serializeReferral(r);
    if (!base) continue;

    const referrerUser = r.user_id;
    const uid = referrerUser?._id || referrerUser;
    const cid = r.conversation_id;
    const lm = uid && cid ? matchByPair.get(pairKeyReferral(uid, cid)) : null;
    const profile = lm?.lead_profile_id ? profileById.get(String(lm.lead_profile_id)) : null;
    const conversation = cid ? convById.get(String(cid)) : null;

    const sourceRoleRaw = String(
      profile?.ownership?.professional_type ||
        (referrerUser && typeof referrerUser === 'object' ? referrerUser.role : '') ||
        'agent'
    ).trim();

    let full_name = String(profile?.identity?.full_name || '').trim();
    let email = String(profile?.identity?.email || '').trim();
    if (!full_name && conversation?.form_data && typeof conversation.form_data === 'object') {
      const fd = conversation.form_data;
      full_name = String(fd.full_name || fd.name || '').trim();
      email = email || String(fd.email || '').trim();
    }

    const lead_contact = {
      full_name: full_name || null,
      email: email || null,
      phone: profile?.identity?.phone ? String(profile.identity.phone).trim() || null : null,
    };

    const lead_summary = buildListLeadSummary(sourceRoleRaw, profile, conversation, lm);

    items.push({
      ...base,
      lead_contact,
      lead_summary,
    });
  }

  return items;
}

/**
 * POST /api/referrals — logged-in professional refers a lead (conversation) to another user.
 */
export async function createReferral(req, res) {
  try {
    const userId = req.user._id;
    const { target_user_id, conversation_id, target_vertical, status, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(conversation_id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation_id' });
    }
    const convOid = new mongoose.Types.ObjectId(conversation_id);

    const lm = await LeadMatch.findOne({
      user_id: userId,
      conversation_id: convOid,
    })
      .select('_id')
      .lean();

    if (!lm) {
      return res.status(403).json({
        success: false,
        message: 'This conversation is not linked to your leads.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(target_user_id)) {
      return res.status(400).json({ success: false, message: 'Invalid target_user_id' });
    }
    const targetOid = new mongoose.Types.ObjectId(target_user_id);
    if (targetOid.equals(userId)) {
      return res.status(400).json({ success: false, message: 'Cannot refer to yourself.' });
    }

    const targetUser = await User.findById(targetOid).select('_id').lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Target professional not found.' });
    }

    const vertical = String(target_vertical || '').trim();
    if (!vertical) {
      return res.status(400).json({ success: false, message: 'target_vertical is required' });
    }

    let nextStatus = 'pending';
    if (status != null && String(status).trim() !== '') {
      if (!REFERRAL_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${REFERRAL_STATUSES.join(', ')}`,
        });
      }
      nextStatus = status;
    }

    if (['pending', 'accepted'].includes(nextStatus)) {
      const inflight = await Referral.findOne({
        user_id: userId,
        conversation_id: convOid,
        status: { $in: ['pending', 'accepted'] },
      })
        .select('_id')
        .lean();
      if (inflight) {
        return res.status(409).json({
          success: false,
          message:
            'This lead already has an active referral (pending or accepted). Finish or reject it before sending another.',
          existing_referral_id: String(inflight._id),
        });
      }
    }

    const referral = await Referral.create({
      user_id: userId,
      target_user_id: targetOid,
      conversation_id: convOid,
      target_vertical: vertical,
      status: nextStatus,
      notes: notes != null ? String(notes) : '',
    });
    const created = await Referral.findById(referral._id)
      .populate('user_id', 'first_name last_name full_name email role profile_image')
      .populate('target_user_id', 'first_name last_name full_name email role profile_image');

    return res.status(201).json({
      success: true,
      referral: serializeReferral(created || referral),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          'This lead already has an active referral (pending or accepted). Finish or reject it before sending another.',
      });
    }
    logger.error('createReferral failed', { err: err?.message });
    return res.status(500).json({ success: false, message: 'Failed to create referral' });
  }
}

/**
 * GET /api/referrals — referrals where current user is referrer or recipient.
 */
export async function listReferrals(req, res) {
  try {
    const uid = req.user._id;

    const directionRaw = String(req.query.direction || '').trim().toLowerCase();
    const usePaged = directionRaw === 'inbound' || directionRaw === 'outbound';

    if (usePaged) {
      const { page, limit, skip } = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.referralsList);
      const filter =
        directionRaw === 'outbound' ? { user_id: uid } : { target_user_id: uid };

      const [total, list] = await Promise.all([
        Referral.countDocuments(filter),
        Referral.find(filter)
          .populate('user_id', 'first_name last_name full_name email role profile_image')
          .populate('target_user_id', 'first_name last_name full_name email role profile_image')
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      const items = await mapReferralsListToApiItems(list);
      const [inbound_total, outbound_total] = await Promise.all([
        Referral.countDocuments({ target_user_id: uid }),
        Referral.countDocuments({ user_id: uid }),
      ]);

      return res.json({
        success: true,
        items,
        pagination: buildPaginationMeta({ page, limit, total }),
        counts: { inbound_total, outbound_total },
      });
    }

    const list = await Referral.find({
      $or: [{ user_id: uid }, { target_user_id: uid }],
    })
      .populate('user_id', 'first_name last_name full_name email role profile_image')
      .populate('target_user_id', 'first_name last_name full_name email role profile_image')
      .sort({ updatedAt: -1 })
      .lean();

    const items = await mapReferralsListToApiItems(list);

    return res.json({
      success: true,
      items,
    });
  } catch (err) {
    logger.error('listReferrals failed', { err: err?.message });
    return res.status(500).json({ success: false, message: 'Failed to load referrals' });
  }
}

/**
 * PATCH /api/referrals/:id — referrer or target updates status / notes.
 */
export async function patchReferral(req, res) {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid referral id' });
    }

    const { status, notes } = req.body;

    const uid = req.user._id;
    const referral = await Referral.findById(id);
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral not found' });
    }

    const isReferrer = referral.user_id.equals(uid);
    const isTarget = referral.target_user_id.equals(uid);
    if (!isReferrer && !isTarget) {
      return res.status(403).json({ success: false, message: 'Not allowed to update this referral' });
    }

    let touched = false;
    if (status !== undefined && status !== null && String(status).trim() !== '') {
      if (!REFERRAL_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${REFERRAL_STATUSES.join(', ')}`,
        });
      }
      referral.status = status;
      touched = true;
    }
    if (notes !== undefined) {
      referral.notes = notes != null ? String(notes) : '';
      touched = true;
    }
    if (!touched) {
      return res.status(400).json({ success: false, message: 'Provide status and/or notes to update' });
    }

    await referral.save();
    const updated = await Referral.findById(referral._id)
      .populate('user_id', 'first_name last_name full_name email role profile_image')
      .populate('target_user_id', 'first_name last_name full_name email role profile_image');

    return res.json({
      success: true,
      referral: serializeReferral(updated || referral),
    });
  } catch (err) {
    logger.error('patchReferral failed', { err: err?.message });
    return res.status(500).json({ success: false, message: 'Failed to update referral' });
  }
}

/**
 * GET /api/referrals/:id/lead
 * View the source lead details tied to a referral.
 */
export async function getReferralLeadDetails(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid referral id' });
    }
    const uid = req.user._id;
    const referral = await Referral.findById(id).lean();
    if (!referral) return res.status(404).json({ success: false, message: 'Referral not found' });

    const isReferrer = String(referral.user_id) === String(uid);
    const isTarget = String(referral.target_user_id) === String(uid);
    if (!isReferrer && !isTarget) {
      return res.status(403).json({ success: false, message: 'Not allowed to view this referral' });
    }

    const sourceLeadMatch = await LeadMatch.findOne({
      user_id: referral.user_id,
      conversation_id: referral.conversation_id,
    }).lean();

    const conversation = await ChatConversation.findById(referral.conversation_id)
      .select('intent lead_score lead_grade lead_classification is_qualified emotional_state form_data')
      .lean();

    const leadProfile = sourceLeadMatch?.lead_profile_id
      ? await LeadProfile.findById(sourceLeadMatch.lead_profile_id)
          .select(
            'identity property qualification lifecycle intent_summary scoring ownership contact_preferences'
          )
          .lean()
      : null;
    const sourceUser = await User.findById(referral.user_id)
      .select('role first_name last_name full_name email profile_image')
      .lean();
    const targetUser = await User.findById(referral.target_user_id)
      .select('role first_name last_name full_name email profile_image')
      .lean();

    const viewerRole = String(req.user?.role || '').trim().toLowerCase();
    /** Prefer lead profile vertical (actual pipeline) over referrer account role — matches referral list / mapLeadProfileForApi. */
    const sourceRole = String(
      leadProfile?.ownership?.professional_type || sourceUser?.role || 'agent'
    ).trim().toLowerCase();
    const actionRole = PROFESSIONAL_TYPE_VALUES.includes(viewerRole) ? viewerRole : sourceRole;

    const roleAdjustedLeadMatch = sourceLeadMatch
      ? {
          ...sourceLeadMatch,
          compatibility_factors: {
            ...(sourceLeadMatch.compatibility_factors || {}),
            professional_type: actionRole || sourceRole || 'agent',
          },
        }
      : null;

    const mappedLead = roleAdjustedLeadMatch
      ? mapLeadMatchToDetail(
          roleAdjustedLeadMatch,
          leadProfile || {},
          conversation || {},
          true,
          { includeIntentField: true }
        )
      : null;

    /**
     * Viewer role is injected on the match for conversion/actions, but that makes
     * mapLeadProfileForApi use lawyer/broker rules (no buyer intent, slim property).
     * Re-merge profile slices from the **source** referrer role so agent referrals
     * still show intent, property type, beds/baths, etc. Conversation fills gaps.
     */
    if (mappedLead) {
      const displayProfType = displayProfessionalTypeFromRole(sourceRole);
      const convIntent =
        conversation?.intent != null ? String(conversation.intent).trim() : '';

      if (leadProfile) {
        const profileDisplay = mapLeadProfileForApi(leadProfile, displayProfType);
        const pi =
          profileDisplay.intent != null && String(profileDisplay.intent).trim() !== ''
            ? profileDisplay.intent
            : null;
        mappedLead.intent = pi || convIntent || mappedLead.intent || null;
        mappedLead.property = profileDisplay.property;
        mappedLead.qualification = profileDisplay.qualification;
      } else if (convIntent) {
        mappedLead.intent = mappedLead.intent || convIntent;
      }

      if (conversation && Object.prototype.hasOwnProperty.call(conversation, 'is_qualified')) {
        mappedLead.is_qualified = conversation.is_qualified;
      }
    }

    return res.json({
      success: true,
      referral: serializeReferral(referral),
      lead: mappedLead
        ? {
            ...mappedLead,
            lead_match_id: String(mappedLead.id || sourceLeadMatch?._id || ''),
            lead_profile_id: sourceLeadMatch?.lead_profile_id ? String(sourceLeadMatch.lead_profile_id) : null,
            source_lead_match: sourceLeadMatch || null,
          }
        : null,
      context: {
        source_professional: userPreview(sourceUser),
        target_professional: userPreview(targetUser),
        source_role: sourceRole || sourceUser?.role || null,
        target_role: targetUser?.role || null,
        action_role: actionRole || null,
      },
    });
  } catch (err) {
    logger.error('getReferralLeadDetails failed', { err: err?.message });
    return res.status(500).json({ success: false, message: 'Failed to load referral lead details' });
  }
}

/**
 * POST /api/referrals/:id/process
 * Accept/process referral by creating a LeadMatch for the recipient if missing.
 */
export async function processReferral(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid referral id' });
    }
    const uid = req.user._id;
    const referral = await Referral.findById(id);
    if (!referral) return res.status(404).json({ success: false, message: 'Referral not found' });
    if (String(referral.target_user_id) !== String(uid)) {
      return res.status(403).json({ success: false, message: 'Only target professional can process referral' });
    }

    const sourceLeadMatch = await LeadMatch.findOne({
      user_id: referral.user_id,
      conversation_id: referral.conversation_id,
    }).lean();
    if (!sourceLeadMatch) {
      return res.status(404).json({ success: false, message: 'Source lead was not found for this referral' });
    }

    let targetLeadMatch = await LeadMatch.findOne({
      user_id: uid,
      conversation_id: referral.conversation_id,
    });

    if (!targetLeadMatch) {
      const targetPro = await ProfessionalProfile.findOne({ user_id: uid }).select('_id').lean();
      targetLeadMatch = await LeadMatch.create({
        user_id: uid,
        professional_profile_id: targetPro?._id || null,
        lead_type: sourceLeadMatch.lead_type || 'unknown',
        lead_profile_id: sourceLeadMatch.lead_profile_id || null,
        conversation_id: sourceLeadMatch.conversation_id,
        match_score: sourceLeadMatch.match_score ?? 0,
        match_status: 'new',
        compatibility_factors: {
          ...(sourceLeadMatch.compatibility_factors || {}),
          referral_source_user_id: String(referral.user_id),
          referral_id: String(referral._id),
          referred_at: new Date().toISOString(),
        },
        icp_fit: sourceLeadMatch.icp_fit || undefined,
        contact_count: sourceLeadMatch.contact_count || 0,
        first_contact_at: sourceLeadMatch.first_contact_at || null,
        last_contact_at: sourceLeadMatch.last_contact_at || null,
      });
    }

    referral.status = 'accepted';
    await referral.save();

    return res.json({
      success: true,
      message: 'Referral processed and lead added to your leads.',
      referral: serializeReferral(referral),
      lead_match_id: String(targetLeadMatch._id),
    });
  } catch (err) {
    logger.error('processReferral failed', { err: err?.message });
    return res.status(500).json({ success: false, message: 'Failed to process referral' });
  }
}
