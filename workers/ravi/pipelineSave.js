import { sendVoiceCallSummary } from '../../services/proChat/voiceCallSummaryEmail.js';
import { persistSalesPipeline } from '../../services/proChat/voiceAgentTurnService.js';
import logger from '../../utils/logger.js';
import { waitForMongo } from './mongo.js';

const SAVE_WAIT_MS = 20000;

export function watchPipeline(c) {
  const { ctx, callId } = c;
  ctx.addShutdownCallback(async () => {
    const pipeline = c.pipeline?.snapshot();
    if (!callId || !pipeline || !pipeline.caller_turns) return;
    if (!(await waitForMongo(SAVE_WAIT_MS))) {
      logger.warn('Ravi sales pipeline was not saved, the database is still unreachable', { call_id: callId });
      return;
    }
    try {
      await persistSalesPipeline({ callId, pipeline });
      logger.info(`Ravi sales pipeline saved role=${pipeline.role} answers=${pipeline.answers.length} pains=${pipeline.pain_points.length} qualified=${pipeline.qualified} next=${pipeline.next_step || 'none'}`, { call_id: callId });
    } catch (error) {
      logger.warn('Ravi sales pipeline was not saved', { call_id: callId, message: error?.message });
      return;
    }
    try {
      const sent = await sendVoiceCallSummary({ callId, pipeline });
      if (sent.sent) logger.info('Ravi sent the call summary email', { call_id: callId });
    } catch (error) {
      logger.warn('Ravi call summary email failed', { call_id: callId, message: error?.message });
    }
  });
}
