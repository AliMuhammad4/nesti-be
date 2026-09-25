import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { ok } from './adminCommon.js';
import { pickSalesPhone } from '../proChat/voicePhone.js';

const SUBSCRIBED = ['free_trial', 'trialing', 'active', 'past_due'];

function text(value) {
  return String(value || '').trim();
}

export async function listAdminSalesPipelineService() {
  const inquiries = await EnterpriseInquiry.find({
    source: { $in: ['demo', 'contact'] },
    status: { $in: ['pending', 'contacted'] },
  })
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();

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

  const items = inquiries
    .map((row) => {
      const linked = row.user_id ? usersById.get(String(row.user_id)) : null;
      const user = linked || usersByEmail.get(text(row.email).toLowerCase()) || null;
      return { row, user };
    })
    .filter(({ user }) => !user || !subscribed.has(String(user._id)))
    .map(({ row, user }) => ({
      id: String(row._id),
      name: text(row.full_name) || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || row.company_name,
      email: text(row.email) || user?.email || '',
      phone: pickSalesPhone({
        inquiryPhone: row.phone,
        profilePhone: user?._id ? profilePhoneByUser.get(String(user._id)) : '',
        userPhone: user?.phone,
      }),
      role: text(row.interest_role) || user?.role || 'lead',
      source: row.source,
      stage: ['interested', 'plan_recommended'].includes(row.voice_outcome)
        ? 'ready'
        : row.status === 'contacted'
          ? 'calling'
          : 'new',
      voice_outcome: row.voice_outcome || '',
      voice_outcome_plan: row.voice_outcome_plan || '',
      user_id: user?._id ? String(user._id) : '',
    }));

  return ok({
    items,
    counts: {
      new: items.filter((item) => item.stage === 'new').length,
      calling: items.filter((item) => item.stage === 'calling').length,
    },
  });
}
