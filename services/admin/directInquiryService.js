import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import logger from '../../utils/logger.js';
import { notifyAdminsOfAdminLead } from '../chat/nestiLanding/notifyAdminsOfLandingLead.js';
import { queueAdminLeadFollowUp } from './adminLeadGuideEmailService.js';
import { emitAdminPlatformLead } from '../realtime/workspaceSocket.js';

function text(value) {
  return String(value || '').trim();
}

const inflight = new Map();

function topicOf(input) {
  const raw = text(input.inquiry_topic || input.source).toLowerCase();
  if (raw === 'demo' || raw === 'support' || raw === 'inquiry') return raw;
  if (raw === 'contact') return 'inquiry';
  return 'inquiry';
}

export async function createDirectAdminInquiry(input = {}) {
  const email = text(input.email).toLowerCase();
  const phone = text(input.phone);
  const fullName = text(input.full_name || input.name);
  const message = text(input.message).slice(0, 4000);
  if (!email && !phone) return null;
  if (!message && !text(input.summary)) return null;
  const topic = topicOf(input);
  const note = message || text(input.summary).slice(0, 4000);
  const key = `${email}|${phone}|${topic}|${note}`;
  if (inflight.has(key)) return inflight.get(key);
  const work = saveDirectInquiry({ email, phone, fullName, topic, note, input });
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

async function saveDirectInquiry({ email, phone, fullName, topic, note, input }) {
  const recent = await EnterpriseInquiry.findOne({
    source: 'direct_inquiry',
    email,
    message: note,
    inquiry_topic: topic,
    createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) },
  }).sort({ createdAt: -1 });
  if (recent) {
    emitAdminPlatformLead({
      schema: 1,
      kind: 'landing_lead_created',
      inquiry_id: String(recent._id),
      name: text(recent.full_name) || fullName,
      audience_role: text(recent.interest_role) || text(input.interest_role),
      href: `/admin/leads/detail/${recent._id}`,
    });
    return recent;
  }
  const inquiry = await EnterpriseInquiry.create({
    email,
    phone,
    full_name: fullName,
    company_name: text(input.company_name || fullName || 'Direct query').slice(0, 160),
    city: text(input.city).slice(0, 120),
    country: text(input.country).slice(0, 80),
    inquiry_topic: topic,
    message: note,
    interest_role: text(input.interest_role || input.role),
    source: 'direct_inquiry',
    status: 'pending',
    transcript: [],
  });
  const topicLabel = topic === 'demo' ? 'demo booking' : topic === 'support' ? 'product support' : 'direct query';
  await notifyAdminsOfAdminLead({
    inquiry,
    body: `${fullName || 'Someone'} (${text(input.interest_role) || 'visitor'}) sent a ${topicLabel} and is on the admin lead list.`,
  }).catch((error) => {
    logger.warn('Direct query was not announced', { error: error?.message });
  });
  queueAdminLeadFollowUp(inquiry._id);
  return inquiry;
}
