import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE } from '../constants/roles.js';
import BulkNurtureJob from '../models/BulkNurtureJob.js';
import { postNurtureDraft, postNurturePreview, postNurtureSend } from './nurtureController.js';
import { fetchProfilesDefault, fetchProfilesForIcpTier, ICP_TIERS } from '../services/lead/leadProfileHelpers.js';
import logger from '../utils/logger.js';
import {
  notifyBulkDraftJobCompleted,
  notifyBulkSendJobCompleted,
} from '../services/nurture/bulkNurtureNotifications.js';

const JOB_TTL_DAYS = 7;
const MAX_BULK_CLIENTS = 500;
const BULK_WORKER_COUNT = 5;
const BULK_BATCH_SIZE = 5;
const DEFAULT_ITEMS_PAGE_SIZE = 10;
const MAX_ITEMS_PAGE_SIZE = 50;
const DRAFT_STEP_TIMEOUT_MS = 90_000;
const STALE_RUNNING_JOB_MS = 10 * 60 * 1000;
const PROCESS_STARTED_AT_MS = Date.now();

function asInt(value, fallback, { min = 1, max = 50 } = {}) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const BULK_SEND_WORKER_COUNT = asInt(process.env.BULK_NURTURE_SEND_WORKERS, 3, { min: 1, max: 10 });
const BULK_SEND_BATCH_SIZE = asInt(process.env.BULK_NURTURE_SEND_BATCH_SIZE, 3, { min: 1, max: 10 });

function userProfessionalRole(user) {
  return String(user?.role || '').trim().toLowerCase();
}

function userIncludesPropertyCards(user) {
  return userProfessionalRole(user) === PROFESSIONAL_TYPE.AGENT;
}

function bulkDraftGoalForUser(user) {
  const role = userProfessionalRole(user);
  if (role === PROFESSIONAL_TYPE.LAWYER) {
    return 'Follow up on their transaction progress, invite them to schedule a legal consultation, and include a concise meeting-preparation checklist with documents to bring and closing-related questions.';
  }
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return 'Follow up on their financing timeline, invite them to schedule a mortgage review, and include a concise meeting-preparation checklist with income, tax, and banking documents to bring.';
  }
  return 'Send a professional follow-up to re-engage this client, invite them to schedule next steps, and include a concise meeting-preparation checklist with documents and priorities to bring to the meeting.';
}

function bulkDraftToneForUser(user) {
  const role = userProfessionalRole(user);
  if (role === PROFESSIONAL_TYPE.LAWYER) {
    return 'formal, reassuring, attorney-office professional';
  }
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return 'clear, confident, financing-focused professional';
  }
  return 'executive, warm, concise, brokerage-grade professional';
}

function nextExpiry() {
  return new Date(Date.now() + JOB_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function publicItem(item) {
  return {
    id: item.lead_profile_id ? String(item.lead_profile_id) : '',
    name: item.name || '',
    email: item.email || '',
    selected: Boolean(item.selected_default),
    status: item.status || 'pending',
    subject: item.subject || '',
    body: item.body || '',
    previewHtml: item.previewHtml || '',
    error: item.error || '',
  };
}

function parseBulkItemsPagination(query = {}) {
  const pageRaw = Number.parseInt(String(query.page ?? ''), 10);
  const limitRaw = Number.parseInt(String(query.limit ?? ''), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_ITEMS_PAGE_SIZE)
      : DEFAULT_ITEMS_PAGE_SIZE;
  return { page, limit };
}

function buildItemsPagination({ page, limit, total }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  return {
    page: safePage,
    limit,
    total,
    total_pages: totalPages,
    has_prev_page: safePage > 1,
    has_next_page: safePage < totalPages,
  };
}

function visibleJobItems(job) {
  const items = Array.isArray(job?.items) ? job.items : [];
  const includeSentDuringSend =
    job?.type === 'bulk_nurture_send' && ['queued', 'running'].includes(job?.status);
  const base = items.filter((item) => {
    if (item.status === 'error') return false;
    if (item.status === 'sent' && !includeSentDuringSend) return false;
    return true;
  });
  if (job?.status === 'paused') {
    return base.filter((item) => item.status === 'ready');
  }
  return base;
}

function publicJob(job, options = {}) {
  const items = visibleJobItems(job);
  const { page = 1, limit = DEFAULT_ITEMS_PAGE_SIZE } = options;
  const pagination = buildItemsPagination({ page, limit, total: items.length });
  const start = (pagination.page - 1) * pagination.limit;
  const pageItems = items.slice(start, start + pagination.limit);
  return {
    success: true,
    job: {
      id: String(job._id),
      type: job.type,
      status: job.status,
      progress: job.progress || {},
      items: pageItems.map(publicItem),
      pagination,
      error: job.error || '',
      created_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      updated_at: job.updatedAt ? new Date(job.updatedAt).toISOString() : null,
    },
  };
}

function restoreStatePayload(job) {
  const visibleItems = visibleJobItems(job);
  return {
    restore_checked: true,
    has_job: Boolean(job?._id),
    has_visible_drafts: visibleItems.length > 0,
    show_empty_state: !job?._id || visibleItems.length === 0,
  };
}

function contactEmail(profile) {
  const c = profile?.identity || profile?.contact || {};
  return String(c.email || c.canonical_email || '').trim();
}

function contactName(profile) {
  const c = profile?.identity || profile?.contact || {};
  return String(c.full_name || c.name || c.email || c.canonical_email || 'Unnamed client').trim();
}

async function callController(handler, req) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        if (statusCode >= 400 || body?.success === false) {
          const err = new Error(body?.message || 'Request failed');
          err.status = statusCode;
          err.body = body;
          reject(err);
          return;
        }
        resolve(body);
      },
    };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}

function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function runBatchedPool(items, worker, { workerCount = BULK_WORKER_COUNT, batchSize = BULK_BATCH_SIZE, shouldContinue } = {}) {
  let index = 0;

  const claimBatch = () => {
    const batch = [];
    while (batch.length < batchSize && index < items.length) {
      batch.push(items[index]);
      index += 1;
    }
    return batch;
  };

  const workers = Array.from(
    { length: Math.min(workerCount, Math.max(items.length, 1)) },
    async () => {
      while (true) {
        if (shouldContinue) {
          const ok = await shouldContinue();
          if (!ok) break;
        }

        const batch = claimBatch();
        if (!batch.length) break;

        await Promise.all(batch.map((item) => worker(item)));
      }
    },
  );

  await Promise.all(workers);
}

async function loadProfilesForBulk(userId, { icp_tier = '' } = {}) {
  const userObjectId = new mongoose.Types.ObjectId(String(userId));
  const icpTier = String(icp_tier || '').trim().toLowerCase();
  if (icpTier && !ICP_TIERS.has(icpTier)) {
    const err = new Error('Invalid icp_tier. Use perfect_match, good_match, or low_match');
    err.status = 400;
    throw err;
  }

  const result = icpTier
    ? await fetchProfilesForIcpTier({
        userObjectId,
        userId: String(userId),
        icpTier,
        skip: 0,
        limit: MAX_BULK_CLIENTS,
      })
    : await fetchProfilesDefault({
        userId: String(userId),
        skip: 0,
        limit: MAX_BULK_CLIENTS,
      });

  return Array.isArray(result.profiles) ? result.profiles : [];
}

async function touchJob(jobId, patch = {}) {
  return BulkNurtureJob.findByIdAndUpdate(
    jobId,
    { ...patch, $set: { ...(patch.$set || {}), expires_at: nextExpiry() } },
    { returnDocument: 'after' },
  ).lean();
}

async function updateJobItem(jobId, leadProfileId, set, inc = {}) {
  await BulkNurtureJob.updateOne(
    { _id: jobId, 'items.lead_profile_id': new mongoose.Types.ObjectId(String(leadProfileId)) },
    {
      $set: Object.fromEntries(
        Object.entries({ ...set, expires_at: nextExpiry() }).map(([key, value]) => [
          key === 'expires_at' ? key : `items.$.${key}`,
          value,
        ]),
      ),
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
    },
  );
}

async function removeJobItem(jobId, leadProfileId) {
  await BulkNurtureJob.updateOne(
    { _id: jobId },
    {
      $pull: { items: { lead_profile_id: new mongoose.Types.ObjectId(String(leadProfileId)) } },
      $set: { expires_at: nextExpiry() },
    },
  );
}

async function removeCompletedItems(jobId) {
  await BulkNurtureJob.updateOne(
    { _id: jobId },
    {
      $pull: { items: { status: { $in: ['sent', 'error'] } } },
      $set: { expires_at: nextExpiry() },
    },
  );
}

function buildDraftProgress(items = []) {
  return items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (['ready', 'sent', 'skipped', 'error'].includes(item.status)) acc.completed += 1;
      if (item.status === 'ready') acc.ready += 1;
      if (item.status === 'sent') acc.sent += 1;
      if (item.status === 'error') acc.failed += 1;
      if (item.status === 'skipped') acc.skipped += 1;
      return acc;
    },
    { total: 0, completed: 0, ready: 0, sent: 0, failed: 0, skipped: 0 },
  );
}

async function processBulkDraftItem(jobId, user, item) {
  const leadProfileId = String(item.lead_profile_id);
  await updateJobItem(jobId, leadProfileId, { status: 'generating', error: '' });
  try {
    const reqBase = { user };
    const draftData = await withTimeout(
      callController(postNurtureDraft, {
        ...reqBase,
        body: {
          lead_profile_id: leadProfileId,
          goal: bulkDraftGoalForUser(user),
          tone: bulkDraftToneForUser(user),
        },
      }),
      DRAFT_STEP_TIMEOUT_MS,
      'Draft generation timed out.',
    );
    const draft = draftData?.draft || {};
    const subject = String(draft.subject || '').trim();
    const body = String(draft.body_text || '').trim();
    if (!subject || !body) throw new Error('Draft was empty.');

    const previewData = await withTimeout(
      callController(postNurturePreview, {
        ...reqBase,
        body: {
          lead_profile_id: leadProfileId,
          subject,
          body,
          include_property_cards: userIncludesPropertyCards(user),
        },
      }),
      DRAFT_STEP_TIMEOUT_MS,
      'Draft preview timed out.',
    );

    await updateJobItem(
      jobId,
      leadProfileId,
      {
        status: 'ready',
        subject,
        body,
        previewHtml: String(previewData?.preview?.html || ''),
        error: '',
      },
      { 'progress.completed': 1, 'progress.ready': 1 },
    );
  } catch (err) {
    const error = err?.message || 'Could not generate follow-up.';
    await updateJobItem(
      jobId,
      leadProfileId,
      { status: 'error', selected_default: false, error },
      { 'progress.completed': 1, 'progress.failed': 1 },
    );
    logger.warn('bulk nurture draft item failed', { profile_id: leadProfileId, error });
  }
}

async function runBulkDraftItems(jobId, { user, items }) {
  const pendingItems = items.filter((item) => !['skipped', 'ready', 'sent', 'error'].includes(item.status));
  let paused = false;

  await runBatchedPool(
    pendingItems,
    (item) => processBulkDraftItem(jobId, user, item),
    {
      shouldContinue: async () => {
        const job = await BulkNurtureJob.findById(jobId).select('status').lean();
        if (!job || job.status === 'paused') {
          paused = true;
          return false;
        }
        if (!['queued', 'running'].includes(job.status)) return false;
        return true;
      },
    },
  );

  const latest = await BulkNurtureJob.findById(jobId).lean();
  if (!latest || latest.status === 'paused' || paused) return;

  const remaining = (latest.items || []).some((item) => ['pending', 'queued', 'generating'].includes(item.status));
  if (!remaining) {
    const completed = await touchJob(jobId, { $set: { status: 'completed' } });
    await notifyBulkDraftJobCompleted(completed);
  }
}

async function resumeInterruptedDraftJob(job, user) {
  const resumableStatuses = new Set(['pending', 'queued', 'generating']);
  const items = (job.items || []).map((item) =>
    resumableStatuses.has(item.status)
      ? { ...item, status: 'pending', error: '' }
      : item,
  );
  const remaining = items.filter((item) => item.status === 'pending');
  const nextStatus = remaining.length ? 'running' : 'completed';
  const resumed = await BulkNurtureJob.findByIdAndUpdate(
    job._id,
    {
      $set: {
        items,
        progress: buildDraftProgress(items),
        status: nextStatus,
        error: remaining.length ? 'Resumed after server restart.' : '',
        expires_at: nextExpiry(),
      },
    },
    { returnDocument: 'after' },
  ).lean();

  if (remaining.length) {
    setImmediate(() => {
      runBulkDraftItems(job._id, { user, items }).catch((err) => {
        logger.error('bulk nurture draft resume failed', { job_id: String(job._id), error: err?.message });
      });
    });
  } else {
    await notifyBulkDraftJobCompleted(resumed);
  }
  return resumed;
}

function bulkJobHasActiveItems(job) {
  if (!job) return false;
  const activeStatuses =
    job.type === 'bulk_nurture_send'
      ? new Set(['pending', 'queued', 'sending'])
      : new Set(['pending', 'queued', 'generating']);
  return (job.items || []).some((item) => activeStatuses.has(item.status));
}

async function ensureBulkJobCompleted(job) {
  if (!job || !['queued', 'running'].includes(job.status)) return job;
  if (bulkJobHasActiveItems(job)) return job;

  return BulkNurtureJob.findByIdAndUpdate(
    job._id,
    {
      $set: {
        status: 'completed',
        progress: buildDraftProgress(job.items || []),
        expires_at: nextExpiry(),
      },
    },
    { returnDocument: 'after' },
  ).lean();
}

async function settleStaleJob(job, { user } = {}) {
  if (!job || !['queued', 'running'].includes(job.status)) return job;
  const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
  const interruptedByRestart = updatedAt > 0 && updatedAt < PROCESS_STARTED_AT_MS;
  const staleByAge = updatedAt > 0 && Date.now() - updatedAt >= STALE_RUNNING_JOB_MS;
  if (!interruptedByRestart && !staleByAge) return job;

  if (job.type === 'bulk_nurture_draft' && user) {
    return resumeInterruptedDraftJob(job, user);
  }

  const activeStatuses = new Set(['pending', 'queued', 'generating', 'sending']);
  const items = (job.items || []).map((item) =>
    activeStatuses.has(item.status)
      ? {
          ...item,
          status: 'error',
          selected_default: false,
          error: 'This bulk job stopped before finishing. Generate again for this client if needed.',
        }
      : item,
  );
  const progress = buildDraftProgress(items);

  return BulkNurtureJob.findByIdAndUpdate(
    job._id,
    {
      $set: {
        items,
        progress,
        status: 'completed',
        error: interruptedByRestart
          ? 'Previous bulk job was interrupted by a server restart.'
          : 'Previous bulk job was stopped before finishing.',
        expires_at: nextExpiry(),
      },
    },
    { returnDocument: 'after' },
  ).lean();
}

async function runBulkDraftJob(jobId, { user, tokenBody }) {
  try {
    await touchJob(jobId, { $set: { status: 'running', error: '' } });
    const profiles = await loadProfilesForBulk(user._id, tokenBody || {});
    const items = profiles.map((profile) => {
      const email = contactEmail(profile);
      const eligible = Boolean(email);
      return {
        lead_profile_id: profile._id,
        name: contactName(profile),
        email,
        selected_default: eligible,
        status: eligible ? 'pending' : 'skipped',
        subject: '',
        body: '',
        previewHtml: '',
        error: eligible ? '' : 'Needs a client email.',
      };
    });
    const skipped = items.filter((item) => item.status === 'skipped').length;

    await touchJob(jobId, {
      $set: {
        items,
        progress: {
          total: items.length,
          completed: skipped,
          ready: 0,
          sent: 0,
          failed: 0,
          skipped,
        },
      },
    });

    await runBulkDraftItems(jobId, { user, items });
  } catch (err) {
    await touchJob(jobId, {
      $set: {
        status: 'failed',
        error: err?.message || 'Bulk draft job failed',
      },
    });
  }
}

async function loadSendItems(userId, { source_job_id, item_ids, send_all = false }) {
  const sourceJobId = String(source_job_id || '').trim();
  const sourceJob = await BulkNurtureJob.findOne({
    _id: sourceJobId,
    user_id: userId,
    type: 'bulk_nurture_draft',
  }).lean();
  if (!sourceJob) {
    const err = new Error('Draft job not found.');
    err.status = 404;
    throw err;
  }
  const selectedIds = new Set((Array.isArray(item_ids) ? item_ids : []).map((id) => String(id)));
  return (sourceJob.items || [])
    .filter(
      (item) =>
        item.status === 'ready' &&
        (send_all || selectedIds.has(String(item.lead_profile_id))),
    )
    .map((item) => ({
      id: String(item.lead_profile_id),
      name: item.name || 'Client',
      email: item.email || '',
      subject: item.subject || '',
      body: item.body || '',
    }));
}

async function runBulkSendJob(jobId, { user, source_job_id, item_ids, send_all = false }) {
  try {
    await touchJob(jobId, { $set: { status: 'running', error: '' } });
    const sourceJobId =
      source_job_id && mongoose.Types.ObjectId.isValid(String(source_job_id))
        ? new mongoose.Types.ObjectId(String(source_job_id))
        : null;
    const selected = await loadSendItems(user._id, { source_job_id, item_ids, send_all });
    const sendItems = selected.map((item) => ({
      lead_profile_id: new mongoose.Types.ObjectId(String(item.id)),
      name: item.name || 'Client',
      email: item.email,
      subject: item.subject,
      body: item.body,
      status: 'pending',
      error: '',
    }));

    await touchJob(jobId, {
      $set: {
        items: sendItems,
        progress: {
          total: sendItems.length,
          completed: 0,
          ready: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
        },
      },
    });

    await runBatchedPool(
      sendItems,
      async (item) => {
        const leadProfileId = String(item.lead_profile_id);
        await updateJobItem(jobId, leadProfileId, { status: 'sending', error: '' });
        if (sourceJobId) {
          await updateJobItem(sourceJobId, leadProfileId, { status: 'sending', error: '' });
        }
        try {
          if (!leadProfileId || !item.email || !item.subject || !item.body) {
            throw new Error('Missing client, email, subject, or body.');
          }
          await callController(postNurtureSend, {
            user,
            body: {
              lead_profile_id: leadProfileId,
              to_email: item.email,
              subject: item.subject,
              body: item.body,
              include_property_cards: userIncludesPropertyCards(user),
            },
          });
          await updateJobItem(
            jobId,
            leadProfileId,
            { status: 'sent', selected_default: false, error: '' },
            { 'progress.completed': 1, 'progress.sent': 1 },
          );
          if (sourceJobId) {
            await removeJobItem(sourceJobId, leadProfileId);
          }
        } catch (err) {
          const error = err?.message || 'Failed to send.';
          await updateJobItem(
            jobId,
            leadProfileId,
            { status: 'error', error },
            { 'progress.completed': 1, 'progress.failed': 1 },
          );
          if (sourceJobId) {
            await updateJobItem(sourceJobId, leadProfileId, { status: 'error', error });
          }
        }
      },
      { workerCount: BULK_SEND_WORKER_COUNT, batchSize: BULK_SEND_BATCH_SIZE },
    );

    const completed = await touchJob(jobId, { $set: { status: 'completed' } });
    await notifyBulkSendJobCompleted(completed);
  } catch (err) {
    await touchJob(jobId, {
      $set: {
        status: 'failed',
        error: err?.message || 'Bulk send job failed',
      },
    });
  }
}

export async function startBulkNurtureDraftJob(req, res, next) {
  try {
    const job = await BulkNurtureJob.create({
      type: 'bulk_nurture_draft',
      user_id: req.user._id,
      status: 'queued',
      filter: { icp_tier: String(req.body?.icp_tier || '').trim().toLowerCase() },
      expires_at: nextExpiry(),
    });
    setImmediate(() => runBulkDraftJob(job._id, { user: req.user, tokenBody: req.body || {} }));
    return res.status(202).json(publicJob(job));
  } catch (err) {
    return next(err);
  }
}

export async function startBulkNurtureSendJob(req, res, next) {
  try {
    const sourceJobId = String(req.body?.source_job_id || '').trim() || null;
    const job = await BulkNurtureJob.create({
      type: 'bulk_nurture_send',
      user_id: req.user._id,
      status: 'queued',
      source_job_id: sourceJobId,
      expires_at: nextExpiry(),
    });
    setImmediate(() =>
      runBulkSendJob(job._id, {
        user: req.user,
        source_job_id: sourceJobId,
        item_ids: req.body?.item_ids || [],
        send_all: Boolean(req.body?.send_all),
      }),
    );
    return res.status(202).json(publicJob(job));
  } catch (err) {
    return next(err);
  }
}

export async function clearBulkNurtureDraftJob(req, res, next) {
  try {
    const job = await BulkNurtureJob.findOneAndDelete({
      _id: String(req.params.jobId || '').trim(),
      user_id: req.user._id,
      type: 'bulk_nurture_draft',
    }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: 'Bulk nurture draft job not found.' });
    }
    return res.json({ success: true, job: null, restore_state: restoreStatePayload(null) });
  } catch (err) {
    return next(err);
  }
}

export async function pauseBulkNurtureDraftJob(req, res, next) {
  try {
    const pagination = parseBulkItemsPagination(req.query || {});
    const job = await BulkNurtureJob.findOneAndUpdate(
      {
        _id: String(req.params.jobId || '').trim(),
        user_id: req.user._id,
        type: 'bulk_nurture_draft',
        status: { $in: ['queued', 'running'] },
      },
      {
        $set: {
          status: 'paused',
          error: 'Paused by user.',
          expires_at: nextExpiry(),
        },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!job) {
      const existing = await BulkNurtureJob.findOne({
        _id: String(req.params.jobId || '').trim(),
        user_id: req.user._id,
        type: 'bulk_nurture_draft',
      }).lean();
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Bulk nurture draft job not found.' });
      }
      return res.json(publicJob(existing, pagination));
    }
    return res.json(publicJob(job, pagination));
  } catch (err) {
    return next(err);
  }
}

export async function resumeBulkNurtureDraftJob(req, res, next) {
  try {
    const pagination = parseBulkItemsPagination(req.query || {});
    const job = await BulkNurtureJob.findOne({
      _id: String(req.params.jobId || '').trim(),
      user_id: req.user._id,
      type: 'bulk_nurture_draft',
    }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: 'Bulk nurture draft job not found.' });
    }
    if (['queued', 'running'].includes(job.status)) {
      return res.json(publicJob(job, pagination));
    }

    const resumableStatuses = new Set(['pending', 'queued', 'generating']);
    const items = (job.items || []).map((item) =>
      resumableStatuses.has(item.status)
        ? { ...item, status: 'pending', error: '' }
        : item,
    );
    const remaining = items.filter((item) => item.status === 'pending');
    const status = remaining.length ? 'running' : 'completed';
    const resumed = await BulkNurtureJob.findByIdAndUpdate(
      job._id,
      {
        $set: {
          items,
          progress: buildDraftProgress(items),
          status,
          error: remaining.length ? 'Resumed by user.' : '',
          expires_at: nextExpiry(),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    if (remaining.length) {
      setImmediate(() => {
        runBulkDraftItems(job._id, { user: req.user, items }).catch((err) => {
          logger.error('bulk nurture draft resume failed', { job_id: String(job._id), error: err?.message });
        });
      });
    } else {
      await notifyBulkDraftJobCompleted(resumed);
    }

    return res.json(publicJob(resumed, pagination));
  } catch (err) {
    return next(err);
  }
}

export async function updateBulkNurtureDraftItem(req, res, next) {
  try {
    const pagination = parseBulkItemsPagination(req.query || {});
    const jobId = String(req.params.jobId || '').trim();
    const itemId = String(req.params.itemId || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();

    const job = await BulkNurtureJob.findOne({
      _id: jobId,
      user_id: req.user._id,
      type: 'bulk_nurture_draft',
      'items.lead_profile_id': new mongoose.Types.ObjectId(itemId),
    }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: 'Draft item not found.' });
    }

    let previewHtml = '';
    try {
      const previewData = await callController(postNurturePreview, {
        user: req.user,
        body: {
          lead_profile_id: itemId,
          subject,
          body,
          include_property_cards: userIncludesPropertyCards(req.user),
        },
      });
      previewHtml = String(previewData?.preview?.html || '');
    } catch (previewErr) {
      logger.warn('bulk nurture edited preview failed', { profile_id: itemId, error: previewErr?.message });
    }

    await updateJobItem(jobId, itemId, {
      subject,
      body,
      ...(previewHtml ? { previewHtml } : {}),
      status: 'ready',
      error: '',
    });

    const nextJob = await BulkNurtureJob.findById(jobId).lean();
    return res.json(publicJob(nextJob, pagination));
  } catch (err) {
    return next(err);
  }
}

export async function getBulkNurtureJob(req, res) {
  const pagination = parseBulkItemsPagination(req.query || {});
  let job = await BulkNurtureJob.findOne({
    _id: String(req.params.jobId || '').trim(),
    user_id: req.user._id,
  }).lean();
  if (!job) {
    return res.status(404).json({ success: false, message: 'Bulk nurture job not found.' });
  }
  job = await settleStaleJob(job, { user: req.user });
  job = await ensureBulkJobCompleted(job);
  if (job.items?.some((item) => item.status === 'sent' || item.status === 'error')) {
    await removeCompletedItems(job._id);
    job = await BulkNurtureJob.findById(job._id).lean();
  }
  return res.json(publicJob(job, pagination));
}

export async function getLatestBulkNurtureJob(req, res) {
  const pagination = parseBulkItemsPagination(req.query || {});
  const type = String(req.query?.type || 'bulk_nurture_draft').trim();
  const allowedTypes = new Set(['bulk_nurture_draft', 'bulk_nurture_send']);
  if (!allowedTypes.has(type)) {
    return res.status(400).json({ success: false, message: 'Invalid bulk nurture job type.' });
  }
  let job = await BulkNurtureJob.findOne({
    user_id: req.user._id,
    type,
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
  if (!job) {
    return res.json({ success: true, job: null, restore_state: restoreStatePayload(null) });
  }
  job = await settleStaleJob(job, { user: req.user });
  job = await ensureBulkJobCompleted(job);
  if (job.items?.some((item) => item.status === 'sent' || item.status === 'error')) {
    await removeCompletedItems(job._id);
    job = await BulkNurtureJob.findById(job._id).lean();
  }
  const visibleItems = visibleJobItems(job);
  if (job?.status === 'completed' && visibleItems.length === 0) {
    await BulkNurtureJob.deleteOne({ _id: job._id, user_id: req.user._id, type });
    return res.json({ success: true, job: null, restore_state: restoreStatePayload(null) });
  }
  return res.json({ ...publicJob(job, pagination), restore_state: restoreStatePayload(job) });
}
