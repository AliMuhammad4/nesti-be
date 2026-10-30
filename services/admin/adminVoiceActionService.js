import VoiceAgentSuggestion from '../../models/VoiceAgentSuggestion.js';
import { fail, ok } from './adminCommon.js';
import { recordAdminAudit } from './adminAuditService.js';
import { patchAdminLeadService } from './adminLeadService.js';
import { adminNurtureDraftService } from './adminLeadOwnerActionsService.js';
import { analyzeAdminLeadInsightsService } from './adminLeadService.js';
import { patchAdminClientService } from './adminClientService.js';
import { adminHasPermission, ADMIN_PERMISSION as P } from '../../constants/adminPermissions.js';

function text(value) {
  return String(value || '').trim();
}

export async function applyVoiceSuggestion({ suggestion, actorUser }) {
  if (!suggestion) return fail(404, 'Suggestion not found');
  if (!adminHasPermission(actorUser, P.LEADS_WRITE) && suggestion.target_type === 'lead') {
    return fail(403, 'Missing leads.write');
  }
  if (!adminHasPermission(actorUser, P.CLIENTS_WRITE) && suggestion.target_type === 'client') {
    return fail(403, 'Missing clients.write');
  }
  let result = fail(400, 'Unsupported voice action');
  const leadPayload = { ...(suggestion.payload || {}) };
  delete leadPayload.lead_id;
  if (suggestion.action === 'lead.patch') {
    result = await patchAdminLeadService(suggestion.target_id, leadPayload, {
      user: actorUser,
      body: leadPayload,
    });
  } else if (suggestion.action === 'lead.nurture.draft') {
    result = await adminNurtureDraftService(suggestion.target_id, leadPayload, actorUser);
  } else if (suggestion.action === 'lead.insights.refresh') {
    result = await analyzeAdminLeadInsightsService(suggestion.target_id);
  } else if (suggestion.action === 'client.patch') {
    result = await patchAdminClientService(suggestion.target_id, suggestion.payload || {});
  }
  const applied = result?.status === 200 && result?.body?.success !== false;
  await VoiceAgentSuggestion.updateOne(
    { _id: suggestion._id },
    {
      $set: {
        status: applied ? 'applied' : 'failed',
        decided_by: text(actorUser?._id),
        decided_at: new Date(),
        error_message: applied ? '' : text(result?.body?.message),
      },
    },
  );
  await recordAdminAudit({
    actorUserId: actorUser?._id,
    action: `voice.suggestion.apply.${suggestion.action}`,
    targetType: suggestion.target_type,
    targetId: suggestion.target_id,
    meta: {
      call_id: String(suggestion.call_id),
      confidence: suggestion.confidence,
      rationale: suggestion.rationale,
    },
    outcome: applied ? 'ok' : 'error',
    errorMessage: applied ? '' : result?.body?.message,
  });
  return applied ? ok({ suggestion_id: String(suggestion._id), status: 'applied', result: result.body }) : result;
}

export async function decideVoiceSuggestion({ suggestionId, actorUser, decision }) {
  const suggestion = await VoiceAgentSuggestion.findById(suggestionId);
  if (!suggestion) return fail(404, 'Suggestion not found');
  if (suggestion.status !== 'pending') return fail(409, 'Suggestion is already decided');
  if (decision === 'reject') {
    suggestion.status = 'rejected';
    suggestion.decided_by = text(actorUser?._id);
    suggestion.decided_at = new Date();
    await suggestion.save();
    await recordAdminAudit({
      actorUserId: actorUser?._id,
      action: 'voice.suggestion.reject',
      targetType: suggestion.target_type,
      targetId: suggestion.target_id,
      meta: { call_id: String(suggestion.call_id), suggestion_id: String(suggestion._id) },
    });
    return ok({ suggestion_id: String(suggestion._id), status: 'rejected' });
  }
  if (decision !== 'approve') return fail(400, 'Invalid decision');
  suggestion.status = 'approved';
  await suggestion.save();
  return applyVoiceSuggestion({ suggestion, actorUser });
}
