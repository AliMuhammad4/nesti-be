import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import logger from '../../utils/logger.js';
import { createLeadLifecycleNotification } from '../notifications/notificationService.js';
import { emitNotification } from '../realtime/workspaceSocket.js';

const FOLLOW_UPS_HREF = '/clients/follow-ups';

function jobIdOf(job) {
  return String(job?._id || '').trim();
}

function progressOf(job) {
  return job?.progress || {};
}

function draftCompletionBody(job) {
  const { ready = 0, failed = 0, skipped = 0 } = progressOf(job);
  const readyCount = Number(ready || 0);
  const failedCount = Number(failed || 0);
  const skippedCount = Number(skipped || 0);

  let body = `${readyCount} draft${readyCount === 1 ? '' : 's'} ready to review and send.`;
  const extras = [];
  if (skippedCount > 0) {
    extras.push(`${skippedCount} skipped (no client email)`);
  }
  if (failedCount > 0) {
    extras.push(`${failedCount} failed to generate`);
  }
  if (extras.length) {
    body = `${body} ${extras.join('. ')}.`;
  }
  return body;
}

function sendCompletionBody(job) {
  const { sent = 0, failed = 0 } = progressOf(job);
  const sentCount = Number(sent || 0);
  const failedCount = Number(failed || 0);

  if (failedCount > 0) {
    return `${sentCount} follow-up email${sentCount === 1 ? '' : 's'} sent. ${failedCount} failed.`;
  }
  return `${sentCount} follow-up email${sentCount === 1 ? '' : 's'} sent successfully.`;
}

async function persistAndEmit(userId, payload) {
  const uid = userId?._id || userId;
  const jobId = String(payload?.action?.job_id || '').trim();
  if (!uid || !jobId) return null;

  const exists = await ProfessionalNotification.findOne({
    user_id: uid,
    notification_type: payload.notification_type,
    'action.job_id': jobId,
  })
    .select('_id')
    .lean();
  if (exists?._id) return null;

  let notification_id = null;
  try {
    const doc = await createLeadLifecycleNotification(uid, payload);
    notification_id = doc?._id ? String(doc._id) : null;
  } catch (err) {
    logger.warn('Bulk nurture notification persist failed', {
      error: err?.message,
      user_id: String(uid),
      type: payload?.notification_type,
      job_id: jobId,
    });
  }

  emitNotification(uid, {
    notification_id,
    notification_type: payload.notification_type,
    title: payload.title,
    body: payload.body,
    severity: payload.severity || 'info',
    action: payload.action || null,
  });

  return notification_id;
}

export async function notifyBulkDraftJobCompleted(job) {
  try {
    const jobId = jobIdOf(job);
    const userId = job?.user_id;
    if (!jobId || !userId || job?.type !== 'bulk_nurture_draft' || job?.status !== 'completed') {
      return null;
    }

    const ready = Number(progressOf(job).ready || 0);
    const failed = Number(progressOf(job).failed || 0);

    return persistAndEmit(userId, {
      notification_type: 'bulk_nurture_drafts_ready',
      title: ready > 0 ? 'Bulk follow-up drafts ready' : 'Bulk draft job finished',
      body: draftCompletionBody(job),
      severity: failed > 0 ? 'high' : 'info',
      action: {
        type: 'open_bulk_followups',
        job_id: jobId,
        href: FOLLOW_UPS_HREF,
      },
    });
  } catch (err) {
    logger.warn('notifyBulkDraftJobCompleted failed', { error: err?.message, job_id: jobIdOf(job) });
    return null;
  }
}

export async function notifyBulkSendJobCompleted(job) {
  try {
    const jobId = jobIdOf(job);
    const userId = job?.user_id;
    if (!jobId || !userId || job?.type !== 'bulk_nurture_send' || job?.status !== 'completed') {
      return null;
    }

    const sent = Number(progressOf(job).sent || 0);
    const failed = Number(progressOf(job).failed || 0);

    return persistAndEmit(userId, {
      notification_type: 'bulk_nurture_send_completed',
      title: sent > 0 ? 'Bulk follow-ups sent' : 'Bulk send finished',
      body: sendCompletionBody(job),
      severity: failed > 0 ? 'high' : 'info',
      action: {
        type: 'open_bulk_followups',
        job_id: jobId,
        source_job_id: job?.source_job_id ? String(job.source_job_id) : '',
        href: FOLLOW_UPS_HREF,
      },
    });
  } catch (err) {
    logger.warn('notifyBulkSendJobCompleted failed', { error: err?.message, job_id: jobIdOf(job) });
    return null;
  }
}
