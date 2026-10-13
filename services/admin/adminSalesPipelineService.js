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
import logger from '../../utils/logger.js';
import {
  cleanDisplayText,
  lastVisibleMessage,
  leadStatus,
  recommendedAdminLeadAction,
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

function displayCompany(value) {
  const company = text(value);
  if (!company || /^homepage chat$/i.test(company)) return '';
  return company;
}

function deskSource(source) {
  if (source === 'landing_chat') return 'Chatbot';
  if (source === 'direct_inquiry') return 'Direct query';
  if (source === 'contact') return 'Contact';
  if (source === 'demo') return 'Demo';
  return source || 'Lead';
}

function deskTopic(row) {
  const topic = text(row.inquiry_topic);
  // The homepage chat form defaults to "inquiry". That is not a direct quick inquiry.
  if (text(row.source) === 'landing_chat' && (!topic || topic === 'inquiry')) return '';
  return topic;
}

async function presentInquiries(inquiries, { fullTranscript = false } = {}) {
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
    const company = displayCompany(row.company_name);
    return {
      id: String(row._id),
      name: text(row.full_name) || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || company,
      email: text(row.email) || user?.email || '',
      phone: pickSalesPhone({
        inquiryPhone: row.phone,
        profilePhone: user?._id ? profilePhoneByUser.get(String(user._id)) : '',
        userPhone: user?.phone,
      }),
      role: text(row.interest_role) || (text(row.source) === 'direct_inquiry' ? 'visitor' : (user?.role || 'lead')),
      source: deskSource(row.source),
      source_key: text(row.source),
      topic: deskTopic(row),
      city: text(row.city),
      country: text(row.country),
      company_name: company,
      message: cleanDisplayText(row.message),
      last_message: lastVisibleMessage(row),
      conversation_turns: userChatTurns(row),
      lead_score: row.lead_score ?? null,
      lead_grade: row.lead_grade || '',
      chat_state: row.chat_state || null,
      chat_events: Array.isArray(row.chat_events) ? row.chat_events : [],
      on_plan: Boolean(user && subscribed.has(String(user._id))),
      created_at: row.createdAt || null,
      transcript: Array.isArray(row.transcript)
        ? (fullTranscript ? row.transcript : row.transcript.slice(-12)).map((item) => ({
          role: item.role,
          text: cleanDisplayText(item.text),
        }))
        : [],
      stage: row.resolved_pipeline_stage || resolveAdminPipelineStage(row),
      status: leadStatus(row),
      reopen_count: Number(row.reopen_count || 0),
      reopened_at: row.reopened_at || null,
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
      next_action: recommendedAdminLeadAction({ ...row, on_plan: Boolean(user && subscribed.has(String(user._id))) }),
      email_draft: {
        subject: text(row.email_draft?.subject),
        body: text(row.email_draft?.body),
        updated_at: row.email_draft?.updated_at || null,
      },
      guide_emails: Array.isArray(row.guide_emails)
        ? row.guide_emails.map((item) => ({
          to_email: text(item.to_email),
          subject: text(item.subject),
          body: text(item.body),
          type: item.type || 'manual',
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
    .limit(100)
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
  const [item] = await presentInquiries([row], { fullTranscript: true });
  if (!item.transcript.length) {
    try {
      item.transcript = await transcriptFromHomepageChat(row);
    } catch (error) {
      logger.warn('Could not load the linked homepage chat transcript', {
        inquiry_id: String(row._id),
        error: error?.message,
      });
    }
  }
  return ok({ item });
}

function wantsActiveBoard(query) {
  return query?.active === '1' || query?.active === 'true' || query?.active === true;
}

const STATUS_FILTERS = ['open', 'joined', 'nurture'];

export function deskRoleKey(value) {
  const role = text(value).toLowerCase();
  if (role.includes('lawyer')) return 'lawyer';
  if (role.includes('broker') || role.includes('mortgage')) return 'broker';
  if (role.includes('agent') || role.includes('realtor')) return 'agent';
  if (role.includes('client') || role.includes('buyer') || role.includes('seller')) return 'client';
  return 'visitor';
}

function pipelineRoleExpression() {
  const role = { $toLower: { $ifNull: ['$interest_role', ''] } };
  return {
    $switch: {
      branches: [
        { case: { $regexMatch: { input: role, regex: 'lawyer' } }, then: 'lawyer' },
        { case: { $regexMatch: { input: role, regex: 'broker|mortgage' } }, then: 'broker' },
        { case: { $regexMatch: { input: role, regex: 'agent|realtor' } }, then: 'agent' },
        { case: { $regexMatch: { input: role, regex: 'client|buyer|seller' } }, then: 'client' },
      ],
      default: 'visitor',
    },
  };
}

function pipelineStageExpression() {
  const userTurns = {
    $filter: {
      input: { $ifNull: ['$transcript', []] },
      as: 'turn',
      cond: { $eq: ['$$turn.role', 'user'] },
    },
  };
  return {
    $switch: {
      branches: [
        { case: { $eq: ['$close_outcome', 'lost'] }, then: 'closed' },
        { case: { $eq: ['$close_outcome', 'won'] }, then: 'ready' },
        { case: { $in: ['$pipeline_stage', ['new', 'calling', 'ready']] }, then: '$pipeline_stage' },
        { case: { $in: ['$voice_outcome', ['interested', 'plan_recommended']] }, then: 'ready' },
        {
          case: {
            $or: [
              { $eq: ['$status', 'contacted'] },
              { $eq: ['$voice_outcome', 'callback'] },
              {
                $and: [
                  { $eq: ['$source', 'landing_chat'] },
                  {
                    $or: [
                      { $gt: [{ $size: userTurns }, 0] },
                      { $gt: [{ $ifNull: ['$chat_state.turns', 0] }, 1] },
                    ],
                  },
                ],
              },
            ],
          },
          then: 'calling',
        },
      ],
      default: 'new',
    },
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pipelineFilter(query = {}) {
  const clauses = [];
  const status = text(query.status).toLowerCase();
  if (STATUS_FILTERS.includes(status)) {
    clauses.push(status === 'open'
      ? { close_outcome: { $nin: ['won', 'lost'] } }
      : { close_outcome: status === 'joined' ? 'won' : 'lost' });
  }
  const role = text(query.role).toLowerCase();
  if (role && role !== 'all') clauses.push({ $expr: { $eq: [pipelineRoleExpression(), role] } });
  const source = text(query.source).toLowerCase();
  if (source === 'chatbot') clauses.push({ source: 'landing_chat' });
  if (source === 'direct-query') clauses.push({ source: 'direct_inquiry' });
  const stage = text(query.stage).toLowerCase();
  if (stage === 'ready') {
    clauses.push({ resolved_pipeline_stage: 'ready', close_outcome: { $ne: 'won' } });
  } else if (['new', 'calling', 'closed'].includes(stage)) {
    clauses.push({ resolved_pipeline_stage: stage });
  }
  const needle = text(query.q);
  if (needle) {
    const regex = new RegExp(escapeRegex(needle), 'i');
    clauses.push({
      $or: ['full_name', 'email', 'phone', 'company_name', 'message', 'city', 'country']
        .map((field) => ({ [field]: regex })),
    });
  }
  return clauses.length ? { $and: clauses } : {};
}

export function buildAdminSalesPipelineAggregation(query, { skip, limit, activeOnly }) {
  const selected = [{ $match: pipelineFilter(query) }, { $sort: { createdAt: -1, _id: -1 } }];
  if (!activeOnly) selected.push({ $skip: skip });
  selected.push(
    { $limit: limit },
    { $set: { transcript: { $slice: [{ $ifNull: ['$transcript', []] }, -12] } } },
    { $unset: ['guide_emails.body', 'email_draft.body'] },
  );
  return [
    { $match: { source: { $in: DESK_SOURCES } } },
    { $set: { resolved_pipeline_stage: pipelineStageExpression() } },
    {
      $facet: {
        items: selected,
        filtered: [{ $match: pipelineFilter(query) }, { $count: 'total' }],
        counts: [{
          $group: {
            _id: null,
            total: { $sum: 1 },
            new: { $sum: { $cond: [{ $eq: ['$resolved_pipeline_stage', 'new'] }, 1, 0] } },
            calling: { $sum: { $cond: [{ $eq: ['$resolved_pipeline_stage', 'calling'] }, 1, 0] } },
            ready: { $sum: { $cond: [{ $eq: ['$resolved_pipeline_stage', 'ready'] }, 1, 0] } },
            closed: { $sum: { $cond: [{ $eq: ['$resolved_pipeline_stage', 'closed'] }, 1, 0] } },
            open: {
              $sum: {
                $cond: [
                  { $not: [{ $in: ['$close_outcome', ['won', 'lost']] }] },
                  1,
                  0,
                ],
              },
            },
            joined: { $sum: { $cond: [{ $eq: ['$close_outcome', 'won'] }, 1, 0] } },
            nurture: { $sum: { $cond: [{ $eq: ['$close_outcome', 'lost'] }, 1, 0] } },
            chatbot: { $sum: { $cond: [{ $eq: ['$source', 'landing_chat'] }, 1, 0] } },
            direct: { $sum: { $cond: [{ $eq: ['$source', 'direct_inquiry'] }, 1, 0] } },
            ready_open: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$resolved_pipeline_stage', 'ready'] },
                      { $not: [{ $in: ['$close_outcome', ['won', 'lost']] }] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        }],
      },
    },
  ];
}

export async function listAdminSalesPipelineService(query = {}) {
  try {
    await syncLandingChatsOntoDesk();
  } catch (error) {
    logger.warn('Could not sync landing chat leads onto the admin pipeline', {
      error: error?.message,
    });
  }
  const { page, limit, skip } = parsePageLimitPagination(query, { defaultLimit: 10, maxLimit: 1000 });
  const activeOnly = wantsActiveBoard(query);
  const [aggregate = {}] = await EnterpriseInquiry.aggregate(
    buildAdminSalesPipelineAggregation(query, { skip, limit, activeOnly }),
  );
  const items = await presentInquiries(aggregate.items || []);
  const counts = {
    new: 0, calling: 0, ready: 0, closed: 0, open: 0, joined: 0,
    nurture: 0, chatbot: 0, direct: 0, ready_open: 0, total: 0,
    ...(aggregate.counts?.[0] || {}),
  };
  delete counts._id;
  const total = aggregate.filtered?.[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return ok({
    items,
    counts,
    pagination: {
      page: activeOnly ? 1 : page,
      limit,
      total,
      pages: totalPages,
      total_pages: totalPages,
      has_prev_page: !activeOnly && page > 1,
      has_next_page: activeOnly ? total > limit : page < totalPages,
    },
  });
}

export async function moveAdminLeadStageService(id, body = {}) {
  if (!mongoose.isValidObjectId(id)) return fail(400, 'Lead id is invalid.');
  const stage = text(body.stage);
  if (!['new', 'calling', 'ready', 'closed'].includes(stage)) return fail(400, 'Choose a pipeline stage.');
  const row = await EnterpriseInquiry.findById(id);
  if (!row || !DESK_SOURCES.includes(row.source || '')) return fail(404, 'Admin lead not found.');
  if (stage === 'closed') {
    if (row.close_outcome === 'won') row.close_note = '';
    row.close_outcome = 'lost';
    row.closed_at = new Date();
    row.status = 'resolved';
  } else {
    row.pipeline_stage = stage;
    row.close_outcome = '';
    row.close_note = '';
    row.closed_at = null;
    if (stage === 'calling' && row.status === 'pending') row.status = 'contacted';
    if (stage === 'ready' && row.status !== 'resolved') row.status = 'contacted';
    if (row.status === 'resolved') row.status = stage === 'new' ? 'pending' : 'contacted';
  }
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

export async function updateAdminSalesLeadRoleService(id, body = {}) {
  if (!mongoose.isValidObjectId(id)) return fail(400, 'Lead id is invalid.');
  const role = text(body.role);
  const VALID_ROLES = ['client', 'agent', 'broker', 'mortgage_broker', 'lawyer', 'visitor'];
  if (!VALID_ROLES.includes(role)) return fail(400, 'Choose a valid role.');
  const row = await EnterpriseInquiry.findById(id);
  if (!row || !DESK_SOURCES.includes(row.source || '')) return fail(404, 'Admin lead not found.');
  row.interest_role = role;
  await row.save();
  emitAdminPlatformLead({
    schema: 1,
    kind: 'admin_lead_updated',
    inquiry_id: String(row._id),
    role,
  });
  const [item] = await presentInquiries([row.toObject()], { fullTranscript: true });
  return ok({ item });
}

export async function deleteAdminSalesLeadService(id) {
  if (!mongoose.isValidObjectId(id)) return fail(400, 'Lead id is invalid.');
  const row = await EnterpriseInquiry.findById(id).select('_id source').lean();
  if (!row || !DESK_SOURCES.includes(row.source || '')) return fail(404, 'Admin lead not found.');
  await EnterpriseInquiry.findByIdAndDelete(id);
  emitAdminPlatformLead({
    schema: 1,
    kind: 'admin_lead_updated',
    inquiry_id: String(row._id),
    deleted: true,
  });
  return ok({ deleted: true, id: String(row._id) });
}
