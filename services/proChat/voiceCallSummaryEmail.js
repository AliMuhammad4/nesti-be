import ClientProfile from '../../models/ClientProfile.js';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import { supportEmail } from '../../constants/support.js';
import { isResendConfigured } from '../../utils/sendEmail.js';
import { sendIdempotentEmail } from '../email/emailDeliveryService.js';
import { EMAIL_GREEN_CTA_STYLE, renderBrandedEmailShell } from '../email/emailTheme.js';
import { escapeHtml } from '../email/userLifecycleEmails.js';
import { painConnections, planPriceText } from './salesPipeline.js';

function text(value) {
  return String(value || '').trim();
}

const NEXT_STEP_TEXT = {
  signup_link: 'Start your Nesti subscription with the link below.',
  demo: 'The Nesti team will reach out to book your demo.',
  human_handoff: 'A person from the Nesti team will follow up with you.',
  summary_email: 'Reply to this email or contact support if you have any questions.',
};

export function renderVoiceCallSummary({ firstName = '', pipeline = {}, checkoutUrl = '' } = {}) {
  const pains = (pipeline.pain_points || []).slice(0, 3);
  const helps = painConnections(pipeline.role, pains).slice(0, 3);
  const plan = text(pipeline.plan_fit);
  const price = plan ? planPriceText(pipeline.role, plan) : '';
  const next = NEXT_STEP_TEXT[pipeline.next_step] || NEXT_STEP_TEXT.summary_email;
  const lines = [
    `Hi${firstName ? ` ${firstName}` : ''},`,
    'Thanks for speaking with Ravi from Nesti. Here is a short summary of the call.',
    pains.length ? `What you shared: ${pains.join(', ')}.` : '',
    helps.length ? `How Nesti can help: ${helps.join('; ')}.` : '',
    plan ? `Recommended plan: ${plan}${price ? ` (${price})` : ''}.` : '',
    `Next step: ${next}`,
    checkoutUrl ? `Signup link: ${checkoutUrl}` : '',
    `Questions? Contact ${supportEmail()}.`,
  ].filter(Boolean);
  const innerHtml = [
    ...lines.filter((line) => !line.startsWith('Signup link:')).map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`),
    checkoutUrl ? `<p style="margin:16px 0;"><a href="${escapeHtml(checkoutUrl)}" style="${EMAIL_GREEN_CTA_STYLE}">Start with Nesti</a></p>` : '',
  ].join('');
  return {
    subject: 'Your Nesti call summary',
    text: lines.join('\n\n'),
    html: renderBrandedEmailShell({ kicker: 'Call summary', title: 'Your Nesti call summary', innerHtml }),
  };
}

async function recipientFor(call) {
  const type = text(call?.voice_target_type);
  const id = text(call?.voice_target_id);
  if (!id) return null;
  if (type === 'sales') {
    const inquiry = await EnterpriseInquiry.findById(id).select('email full_name').lean();
    return inquiry?.email ? { email: text(inquiry.email), firstName: text(inquiry.full_name).split(/\s+/)[0] } : null;
  }
  if (type === 'client') {
    const client = await ClientProfile.findById(id).populate('user_id', 'email first_name').lean();
    const user = client?.user_id;
    return user?.email ? { email: text(user.email), firstName: text(user.first_name) } : null;
  }
  return null;
}

export async function sendVoiceCallSummary({ callId, pipeline }) {
  if (!callId || !pipeline?.follow_up_consent || pipeline.do_not_call) return { sent: false, reason: 'no consent' };
  if (!isResendConfigured()) return { sent: false, reason: 'email not configured' };
  const call = await ProfessionalCall.findById(callId).select('voice_target_type voice_target_id voice_checkout_url').lean();
  if (!call || call.voice_target_type === 'test') return { sent: false, reason: 'not a live call' };
  const to = await recipientFor(call);
  if (!to?.email) return { sent: false, reason: 'no email on file' };
  const message = renderVoiceCallSummary({ firstName: to.firstName, pipeline, checkoutUrl: text(call.voice_checkout_url) });
  const result = await sendIdempotentEmail({
    email: to.email,
    subject: message.subject,
    message: message.text,
    htmlMessage: message.html,
    source: 'ravi_call_summary',
    idempotencyKey: `ravi-call-summary:${callId}`,
  });
  if (result?.success) {
    await ProfessionalCall.updateOne({ _id: callId }, { $set: { 'voice_pipeline.summary_sent_at': new Date() } });
    if (call.voice_target_type === 'sales') {
      await EnterpriseInquiry.updateOne({ _id: call.voice_target_id }, { $set: { 'voice_pipeline.summary_sent_at': new Date() } });
    }
  }
  return { sent: Boolean(result?.success) };
}
