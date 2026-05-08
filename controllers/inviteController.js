import {
  createInviteLinkForUser,
  listInviteLinksForUser,
  resolveInviteToken,
  captureInviteAttribution,
  finalizeInviteAttribution,
  getInviteMetricsForUser,
  listInviteConversionsForUser,
} from '../services/referral/inviteService.js';
import { listReferralRewardEvents } from '../services/referral/rewardService.js';

function sendServiceResult(res, result, fallbackSuccessBody) {
  if (result?.ok === false) {
    return res.status(result.code || 400).json({
      success: false,
      message: result.message || 'Request failed',
    });
  }
  return res.json(fallbackSuccessBody || { success: true, ...result });
}

export async function createInviteLink(req, res, next) {
  try {
    const created = await createInviteLinkForUser(req.user._id, req.body || {});
    if (created?.ok === false) {
      return res.status(created.code || 400).json({
        success: false,
        message: created.message || 'Unable to create invite link',
      });
    }
    return res.status(201).json({
      success: true,
      message: 'Invite link created',
      ...created,
    });
  } catch (error) {
    return next(error);
  }
}

export async function listInviteLinks(req, res, next) {
  try {
    const data = await listInviteLinksForUser(req.user._id, req.query || {});
    return res.json({ success: true, ...data });
  } catch (error) {
    return next(error);
  }
}

export async function resolveInvite(req, res, next) {
  try {
    const result = await resolveInviteToken(req.params.token);
    return sendServiceResult(res, result, { success: true, ...result });
  } catch (error) {
    return next(error);
  }
}

export async function captureInvite(req, res, next) {
  try {
    const result = await captureInviteAttribution(req.body?.token, req.body || {}, {
      ip: req.ip,
      user_agent: req.headers['user-agent'] || '',
    });
    return sendServiceResult(res, result, { success: true, ...result });
  } catch (error) {
    return next(error);
  }
}

export async function finalizeInvite(req, res, next) {
  try {
    const result = await finalizeInviteAttribution({
      invite_token: req.body?.token || req.body?.invite_token || '',
      authenticated_user_id: req.user?._id,
      method: req.body?.method || '',
      path: req.body?.path || req.path,
    });
    return sendServiceResult(res, result, {
      success: true,
      message: result.already_converted
        ? 'Invite attribution already finalized'
        : 'Invite attribution finalized',
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

export async function inviteMetrics(req, res, next) {
  try {
    const metrics = await getInviteMetricsForUser(req.user._id, req.query || {});
    return res.json({ success: true, metrics });
  } catch (error) {
    return next(error);
  }
}

export async function listInviteRewardEvents(req, res, next) {
  try {
    const events = await listReferralRewardEvents(req.user._id, req.query || {});
    return res.json({ success: true, ...events });
  } catch (error) {
    return next(error);
  }
}

export async function listInviteConversions(req, res, next) {
  try {
    const days = req.query?.days;
    const page = req.query?.page;
    const limit = req.query?.limit;
    const data = await listInviteConversionsForUser(req.user._id, { days, page, limit });
    return res.json({ success: true, ...data });
  } catch (error) {
    return next(error);
  }
}
