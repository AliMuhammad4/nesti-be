import mongoose from 'mongoose';
import Referral from '../models/Referral.js';
import logger from '../utils/logger.js';
import { REFERRAL_STATUSES } from '../constants/validationEnums.js';
import {
  parsePageLimitPagination,
  buildPaginationMeta,
  PAGINATION_PRESETS,
} from '../utils/pagination.js';
import {
  mapReferralsListToApiItems,
  buildReferralLeadDetailsResponse,
  processReferralForTarget,
  createReferralForUser,
  patchReferralForUser,
} from '../services/referral/referralService.js';

/**
 * POST /api/referrals — logged-in professional refers a lead (conversation) to another user.
 */
export async function createReferral(req, res) {
  try {
    const result = await createReferralForUser(req.user._id, req.body);
    if (!result.ok) {
      const payload = { success: false, message: result.message };
      if (result.existing_referral_id) {
        payload.existing_referral_id = result.existing_referral_id;
      }
      return res.status(result.code).json(payload);
    }
    return res.status(201).json({ success: true, referral: result.referral });
  } catch (err) {
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
      const statusRaw = String(req.query.status || '').trim().toLowerCase();
      const statusFilter = REFERRAL_STATUSES.includes(statusRaw) ? statusRaw : '';
      const filter =
        directionRaw === 'outbound' ? { user_id: uid } : { target_user_id: uid };
      if (statusFilter) filter.status = statusFilter;

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

      const items = await mapReferralsListToApiItems(list, uid);
      const [inbound_total, outbound_total, inbound_pending_total] = await Promise.all([
        Referral.countDocuments({ target_user_id: uid }),
        Referral.countDocuments({ user_id: uid }),
        Referral.countDocuments({ target_user_id: uid, status: 'pending' }),
      ]);

      return res.json({
        success: true,
        items,
        pagination: buildPaginationMeta({ page, limit, total }),
        counts: { inbound_total, outbound_total, inbound_pending_total },
      });
    }

    const list = await Referral.find({
      $or: [{ user_id: uid }, { target_user_id: uid }],
    })
      .populate('user_id', 'first_name last_name full_name email role profile_image')
      .populate('target_user_id', 'first_name last_name full_name email role profile_image')
      .sort({ updatedAt: -1 })
      .lean();

    const items = await mapReferralsListToApiItems(list, uid);

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
    const result = await patchReferralForUser(req.user._id, req.params.id, {
      status: req.body?.status,
      notes: req.body?.notes,
    });
    if (!result.ok) {
      return res.status(result.code).json({ success: false, message: result.message });
    }
    return res.json({ success: true, referral: result.referral });
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

    const payload = await buildReferralLeadDetailsResponse(referral, uid, req.user?.role);
    return res.json({ success: true, ...payload });
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

    const result = await processReferralForTarget(referral, uid);
    if (!result.ok) {
      return res.status(result.code || 500).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      message: 'Referral processed and lead added to your leads.',
      referral: result.referral,
      lead_match_id: result.lead_match_id,
    });
  } catch (err) {
    logger.error('processReferral failed', { err: err?.message });
    return res.status(500).json({ success: false, message: 'Failed to process referral' });
  }
}
