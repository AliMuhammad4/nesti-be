import ChatConversation from '../../models/ChatConversation.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import logger from '../../utils/logger.js';
import { getAgentActionFlow } from '../chat/config/agentActionFlow.js';
import { getMortgageBrokerActionFlow } from '../chat/config/mortgageBrokerActionFlow.js';
import { flowTypeForConversation } from '../chatService.js';
import { agentDisplayName } from './postBooking/postBookingContext.js';
import { comprehensivePlainText, SECTION_TITLES, wrapComprehensiveEmail } from './postBooking/postBookingEmailHtml.js';
import { sendVisitorAndAgentCopy } from './postBooking/postBookingMailer.js';
import { alreadyRan, appendRun } from './postBooking/postBookingPersistence.js';
import { SECTION_BUILDERS } from './postBooking/postBookingSectionBuilders.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

export async function runPostBookingAutomations({
  conversationId,
  userId,
  inviteeEmail,
  inviteeUri,
  leadMatchId,
}) {
  const dedupe = String(inviteeUri || inviteeEmail || 'unknown').slice(0, 512);

  const conversation = await ChatConversation.findById(conversationId);
  if (!conversation) {
    logger.warn('postBooking: conversation not found', { conversationId: String(conversationId) });
    return;
  }

  const uid = userId || conversation.user_id;
  const [professionalProfile, agentUser] = await Promise.all([
    ProfessionalProfile.findOne({ user_id: uid }),
    User.findById(uid).select('email first_name last_name').lean(),
  ]);

  const flowType = await flowTypeForConversation(conversation, professionalProfile);
  const intent = conversation.intent === 'sell' ? 'sell' : 'buy';
  const actionFlow =
    flowType === PROFESSIONAL_TYPE.MORTGAGE_BROKER
      ? getMortgageBrokerActionFlow(conversation.lead_grade || 'unscored')
      : getAgentActionFlow(conversation.lead_grade || 'unscored', intent);
  const keys = actionFlow.postBookingAutomations || [];

  if (!keys.length) {
    logger.debug('postBooking: no automations for tier', {
      conversationId: String(conversationId),
      lead_grade: conversation.lead_grade,
      intent,
    });
    return;
  }

  const claimed = await ChatConversation.updateOne(
    { _id: conversationId, post_booking_digest_dedupes: { $nin: [dedupe] } },
    { $push: { post_booking_digest_dedupes: { $each: [dedupe], $slice: -100 } } }
  );
  if (claimed.modifiedCount === 0) {
    logger.info('postBooking: skip duplicate Calendly delivery (digest already claimed for this invitee)', {
      conversationId: String(conversationId),
    });
    return;
  }

  const releaseDigestClaim = () =>
    ChatConversation.updateOne({ _id: conversationId }, { $pull: { post_booking_digest_dedupes: dedupe } }).catch(
      () => {}
    );

  const ctxBase = {
    conversation,
    userId:       uid,
    inviteeEmail: inviteeEmail ? String(inviteeEmail).trim() : '',
    inviteeUri,
    leadMatchId,
    professionalProfile,
    agentUser,
    flowType,
  };

  /** @type {{ key: string, detail: string, title: string, html: string }[]} */
  const digestSections = [];

  try {
    for (const key of keys) {
      const fresh = await ChatConversation.findById(conversationId).lean();
      if (!fresh || alreadyRan(fresh, key, dedupe)) continue;

      const builder = SECTION_BUILDERS[key];
      if (!builder) {
        logger.warn('postBooking: unknown automation key', { key });
        await appendRun(conversationId, {
          key,
          dedupe_key: dedupe,
          status:     'skipped',
          detail:     'unknown_key',
        });
        continue;
      }

      try {
        const ctx = { ...ctxBase, conversation: fresh, _key: key };
        const result = await builder(ctx);

        if (result.status === 'completed' && result.sectionHtml && SECTION_TITLES[key]) {
          digestSections.push({
            key,
            detail: String(result.detail || ''),
            title:  SECTION_TITLES[key],
            html:   result.sectionHtml,
          });
        } else {
          await appendRun(conversationId, {
            key,
            dedupe_key: dedupe,
            status:     result.status,
            detail:     result.detail,
          });
          logger.info('postBooking automation', {
            key,
            status:         result.status,
            conversationId: String(conversationId),
            detail:         result.detail,
          });
        }
      } catch (err) {
        logger.error(`postBooking automation ${key}: ${err.message}`, { stack: err.stack });
        await appendRun(conversationId, {
          key,
          dedupe_key: dedupe,
          status:     'failed',
          detail:     err.message?.slice(0, 500) || 'error',
        });
      }
    }

    if (!digestSections.length) {
      await releaseDigestClaim();
      return;
    }

    const sendCtx = { ...ctxBase, conversation };
    const agentName = agentDisplayName(sendCtx);
    const combinedHtml = wrapComprehensiveEmail(
      agentName,
      digestSections.map(({ title, html }) => ({ title, html }))
    );
    const plainText = comprehensivePlainText(
      agentName,
      digestSections.map((s) => s.title)
    );

    let sendResult;
    try {
      sendResult = await sendVisitorAndAgentCopy(sendCtx, {
        visitorSubject: `Consultation materials from ${agentName}`,
        html:           combinedHtml,
        text:           plainText,
      });
    } catch (err) {
      logger.error(`postBooking digest send: ${err.message}`, { stack: err.stack });
      sendResult = { status: 'failed', detail: err.message?.slice(0, 200) || 'send_error' };
    }

    const finalStatus = sendResult.status === 'completed' ? 'completed' : sendResult.status;
    const finalDetail =
      sendResult.status === 'completed'
        ? 'digest_email'
        : String(sendResult.detail || sendResult.status || 'send_failed');

    for (const { key, detail } of digestSections) {
      await appendRun(conversationId, {
        key,
        dedupe_key: dedupe,
        status:     finalStatus,
        detail:     finalStatus === 'completed' ? detail : finalDetail,
      });
      logger.info('postBooking automation', {
        key,
        status:         finalStatus,
        conversationId: String(conversationId),
        detail:         finalStatus === 'completed' ? detail : finalDetail,
        digest:         true,
      });
    }

    if (finalStatus === 'completed') {
      logger.info('postBooking: consultation email sent', {
        conversationId: String(conversationId),
        sections:       digestSections.map((s) => s.key),
      });
    } else {
      await releaseDigestClaim();
    }
  } catch (err) {
    await releaseDigestClaim();
    throw err;
  }
}
