import mongoose from 'mongoose';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { fail, ok } from './adminCommon.js';
import { pickSalesPhone } from '../proChat/voicePhone.js';
import { syncLandingChatsOntoDesk } from '../chat/nestiLanding/notifyAdminsOfLandingLead.js';
import ChatConversation from '../../models/ChatConversation.js';
import ChatMessage from '../../models/ChatMessage.js';
import { parsePageLimitPagination } from '../../utils/pagination.js';
import { emitAdminPlatformLead } from '../realtime/workspaceSocket.js';
import {
  lastVisibleMessage,
  resolveAdminPipelineStage,
  userChatTurns,
} from './adminPipelineStage.js';

const SUBSCRIBED = ['free_trial', 'trialing', 'active', 'past_due'];
// Admin lead pipeline should only include homepage chatbot and direct inquiry records.
// Property-match records are a separate lead detail surface and should not be counted here.
const DESK_SOURCES = ['landing_chat', 'direct_inquiry'];

function text(value) {
  return String(value || '').trim();
}

function deskSource(source) {
  if (source === 'landing_chat') return 'Chatbot';
  if (source === 'direct_inquiry') return 'Direct query';
  if (source === 'contact') return 'Contact';
  if (source === 'demo') return 'Demo';
  return source || 'Lead';
}

async function presentInquiries(inquiries) {
  const emails = [...new Set(inquiries.map((row) => text(row.email).toLowerCase()).filter(Boolean))];
  const emailUsers = emails.length
    ? await User.find({ email: { $in: emails } }).collation({ locale: 'en', strength: 2 }).select('_id email first_name last_name phone role').lean()
    : [];
  const userIds = [
    ...new Set([
      ...inquiries.map((row) => (row.user_id ? String(row.user_id) : '')).filter(Boolean),
      ...emailUsers.map((user) => String(user._id)),
    ]),
  ];
  const [users, profiles, proSubs, clientSubs] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select('first_name last_name email phone role').lean() : [],
    userIds.length ? ProfessionalProfile.find({ user_id: { $in: userIds } }).select('user_id phone').lean() : [],
    userIds.length
      ? Subscription.find({ user_id: { $in: userIds }, status: { $in: SUBSCRIBED } }).select('user_id').lean()
      : [],
    userIds.length
      ? ClientSubscription.find({ user_id: { $in: userIds }, status: { $in: ['trialing', 'active', 'past_due'] } }).select('user_id').lean()
      : [],
  ]);
  const subscribed = new Set([
    ...proSubs.map((row) => String(row.user_id)),
    ...clientSubs.map((row) => String(row.user_id)),
  ]);
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const profilePhoneByUser = new Map(profiles.map((profile) => [String(profile.user_id), profile.phone]));
  const usersByEmail = new Map(emailUsers.map((user) => [text(user.email).toLowerCase(), user]));

  return inquiries.map((row) => {
    const linked = row.user_id ? usersById.get(String(row.user_id)) : null;
    const user = linked || usersByEmail.get(text(row.email).toLowerCase()) || null;
    return {
      id: String(row._id),
      name: text(row.full_name) || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || row.company_name,
      email: text(row.email) || user?.email || '',
      phone: pickSalesPhone({
        inquiryPhone: row.phone,
        profilePhone: user?._id ? profilePhoneByUser.get(String(user._id)) : '',
        userPhone: user?.phone,
      }),
      role: text(row.interest_role) || (text(row.source) === 'direct_inquiry' ? 'visitor' : (user?.role || 'lead')),
      source: deskSource(row.source),
      source_key: text(row.source),
      topic: text(row.inquiry_topic),
      city: text(row.city),
      country: text(row.country),
      company_name: text(row.company_name),
      message: text(row.message),
      last_message: lastVisibleMessage(row),
      conversation_turns: userChatTurns(row),
      on_plan: Boolean(user && subscribed.has(String(user._id))),
      created_at: row.createdAt || null,
      transcript: Array.isArray(row.transcript)
        ? row.transcript.slice(-12).map((item) => ({
          role: item.role,
          text: text(item.text),
        }))
        : [],
      stage: resolveAdminPipelineStage(row),
      voice_outcome: row.voice_outcome || '',
      voice_outcome_plan: row.voice_outcome_plan || '',
      user_id: user?._id ? String(user._id) : '',
      close_outcome: row.close_outcome || '',
      close_note: text(row.close_note),
      closed_at: row.closed_at || null,
      insights: {
        summary: text(row.insights?.summary),
        services: Array.isArray(row.insights?.services) ? row.insights.services.map((item) => text(item)).filter(Boolean) : [],
        plan_fit: text(row.insights?.plan_fit) === '[object Object]' ? '' : text(row.insights?.plan_fit),
        next_step: text(row.insights?.next_step) === '[object Object]' ? '' : text(row.insights?.next_step),
        generated_at: row.insights?.generated_at || null,
      },
      email_draft: {
        subject: text(row.email_draft?.subject),
        body: text(row.email_draft?.body),
        updated_at: row.email_draft?.updated_at || null,
      },
      guide_emails: Array.isArray(row.guide_emails)
        ? row.guide_emails.map((item) => ({
          subject: text(item.subject),
          body: text(item.body),
          status: item.status || 'sent',
          sent_at: item.sent_at || null,
        }))
        : [],
    };
  });
}

async function transcriptFromHomepageChat(row) {
  const email = text(row.email).toLowerCase();
  const sessionId = text(row.session_id);
  let convo = null;
  if (sessionId) {
    convo = await ChatConversation.findOne({ channel: 'landing', session_id: sessionId }).sort({ createdAt: -1 }).select('_id').lean();
  }
  if (!convo?._id && email) {
    convo = await ChatConversation.findOne({ channel: 'landing', 'form_data.email': email }).sort({ createdAt: -1 }).select('_id').lean();
  }
  if (!convo?._id) return [];
  const messages = await ChatMessage.find({ conversation_id: convo._id })
    .sort({ createdAt: 1 })
    .limit(24)
    .select('role content')
    .lean();
  return messages
    .map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', text: text(item.content) }))
    .filter((item) => item.text);
}

export async function getAdminSalesLeadService(id) {
  if (!mongoose.isValidObjectId(id)) return fail(400, 'Lead id is invalid.');
  const row = await EnterpriseInquiry.findById(id).lean();
  if (!row || !DESK_SOURCES.includes(row.source || '')) {
    return fail(404, 'Admin lead not found.');
  }
  const [item] = await presentInquiries([row]);
  if (!item.transcript.length) {
    item.transcript = await transcriptFromHomepageChat(row).catch(() => []);
  }
  return ok({ item });
}

export async function listAdminSalesPipelineService(query = {}) {
  await syncLandingChatsOntoDesk().catch(() => {});
  const { page, limit, skip } = parsePageLimitPagination(query, { defaultLimit: 10, maxLimit: 1000 });
  const filter = { source: { $in: DESK_SOURCES } };
  const [total, allInquiries] = await Promise.all([
    EnterpriseInquiry.countDocuments(filter),
    EnterpriseInquiry.find(filter)
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const pageInquiries = allInquiries.slice(skip, skip + limit);
  const items = await presentInquiries(pageInquiries);
  const counts = {
    new: 0,
    calling: 0,
    ready: 0,
  };
  for (const inquiry of allInquiries) {
    const stage = resolveAdminPipelineStage(inquiry);
    if (stage === 'new') counts.new += 1;
    if (stage === 'calling') counts.calling += 1;
    if (stage === 'ready') counts.ready += 1;
  }
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return ok({
    items,
    counts,
    pagination: {
      page,
      limit,
      total,
      pages: totalPages,
      total_pages: totalPages,
      has_prev_page: page > 1,
      has_next_page: page < totalPages,
    },
  });
}

export async function moveAdminLeadStageService(id, body = {}) {
  if (!mongoose.isValidObjectId(id)) return fail(400, 'Lead id is invalid.');
  const stage = text(body.stage);
  if (!['new', 'calling', 'ready'].includes(stage)) return fail(400, 'Choose a pipeline stage.');
  const row = await EnterpriseInquiry.findById(id);
  if (!row || !DESK_SOURCES.includes(row.source || '')) return fail(404, 'Admin lead not found.');
  row.pipeline_stage = stage;
  if (stage === 'calling' && row.status === 'pending') row.status = 'contacted';
  if (stage === 'ready' && row.status !== 'resolved') row.status = 'contacted';
  await row.save();
  emitAdminPlatformLead({
    schema: 1,
    kind: 'admin_lead_updated',
    inquiry_id: String(row._id),
    stage,
  });
  const [item] = await presentInquiries([row.toObject()]);
  return ok({ item });
}
