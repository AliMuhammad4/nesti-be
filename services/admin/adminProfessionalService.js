import mongoose from 'mongoose';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import Referral from '../../models/Referral.js';
import Subscription from '../../models/Subscription.js';
import User from '../../models/User.js';
import PublicProfile from '../../models/PublicProfile.js';
import ProfileViewEvent from '../../models/ProfileViewEvent.js';
import {
  USER_LIST,
  USER_PUBLIC,
  parsePaging,
  escapeRegex,
  applyDateRange,
  parseSort,
  findUserIdsBySearch,
  ok,
  fail,
  serializeUser,
} from './adminCommon.js';
import { serializeCredentialStateAsync } from '../credentials/credentialService.js';
import { evaluateProfessionalProfileSetup } from '../../utils/professionalProfileSetup.js';
import { CREDENTIAL_STATUS_VALUES } from '../../constants/credentialDocuments.js';
import { getPlan } from '../billing/plans.js';
import {
  serializeStorefrontTemplateEntitlements,
  templatePurchasePeriodEnd,
} from '../billing/storefrontTemplates/access.js';
import { getStorefrontTemplateTier, normalizeTemplateId } from '../billing/storefrontTemplates/tiers.js';
import { refreshStorefrontTemplateSubscriptionsForUser } from '../billing/storefrontTemplates/refresh.js';
import { repairPlatformSubscriptionIfTemplateCollision } from '../billing/subscriptionStripeSyncService.js';
import { listPaidInvoicesForUser } from '../billing/subscriptionInvoiceService.js';
import { deriveLeadInquirySource } from './adminLeadService.js';

const OPEN_LEAD_STATUSES = ['new', 'consult_booked', 'showing_booked', 'nurturing'];
const TRAFFIC_DAYS = 30; // unique visitors use this window; lead counts are all-time


function asObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function dateKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ownerLeadFilter(userId, professionalProfileId) {
  const clauses = [];
  const userOid = asObjectId(userId);
  const profileOid = asObjectId(professionalProfileId);
  if (userOid) clauses.push({ user_id: userOid });
  if (profileOid) clauses.push({ professional_profile_id: profileOid });
  if (!clauses.length) return null;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

async function loadLeadInsights(userId, professionalProfileId) {
  const match = ownerLeadFilter(userId, professionalProfileId);
  const emptyOutcomes = { total: 0, open: 0, won: 0, lost: 0, closed: 0, by_status: {} };
  if (!match) {
    return { recentLeads: [], outcomes: emptyOutcomes, chatbotLeads: 0, formLeads: 0 };
  }
  const [row] = await LeadMatch.aggregate([
    { $match: match },
    {
      $facet: {
        recent: [
          { $sort: { createdAt: -1 } },
          { $limit: 8 },
          {
            $project: {
              lead_type: 1,
              match_status: 1,
              createdAt: 1,
              'compatibility_factors.property_inquiry.title': 1,
              'compatibility_factors.client_profile.full_name': 1,
            },
          },
        ],
        byStatus: [
          { $group: { _id: '$match_status', count: { $sum: 1 } } },
        ],
        sources: [
          {
            $project: {
              conversation_id: 1,
              compatibility_factors: {
                source: '$compatibility_factors.source',
                inquiry_source: '$compatibility_factors.inquiry_source',
                chat_thread_id: '$compatibility_factors.chat_thread_id',
              },
            },
          },
        ],
      },
    },
  ]);

  const by_status = Object.fromEntries(
    (row?.byStatus || []).map((item) => [item._id || 'unknown', item.count]),
  );
  const won = Number(by_status.converted || 0);
  const lost = Number(by_status.closed_lost || 0);
  const open = OPEN_LEAD_STATUSES.reduce((sum, status) => sum + Number(by_status[status] || 0), 0);
  const total = Object.values(by_status).reduce((sum, count) => sum + Number(count || 0), 0);

  let chatbotLeads = 0;
  let formLeads = 0;
  for (const lead of row?.sources || []) {
    const source = deriveLeadInquirySource(lead);
    if (source === 'chatbot') chatbotLeads += 1;
    else if (source === 'form') formLeads += 1;
  }

  return {
    recentLeads: row?.recent || [],
    outcomes: { total, open, won, lost, closed: won + lost, by_status },
    chatbotLeads,
    formLeads,
  };
}

async function countReferrals(userId) {
  const oid = asObjectId(userId);
  if (!oid) return { sent: 0, received: 0 };
  const [row] = await Referral.aggregate([
    { $match: { $or: [{ user_id: oid }, { target_user_id: oid }] } },
    {
      $group: {
        _id: null,
        sent: { $sum: { $cond: [{ $eq: ['$user_id', oid] }, 1, 0] } },
        received: { $sum: { $cond: [{ $eq: ['$target_user_id', oid] }, 1, 0] } },
      },
    },
  ]);
  return { sent: Number(row?.sent || 0), received: Number(row?.received || 0) };
}

async function summarizePageTraffic(userId, { chatbotLeads = 0, formLeads = 0, days = TRAFFIC_DAYS } = {}) {
  const empty = {
    period_days: days,
    profile_views: 0,
    unique_visitors: 0,
    chatbot_opens: 0,
    chatbot_leads: Number(chatbotLeads || 0),
    form_leads: Number(formLeads || 0),
    consultation_requests: 0,
    leads_generated: 0,
    traffic_sources: { direct: 0, referral: 0, social: 0, search: 0, other: 0 },
    views_by_day: [],
  };
  const oid = asObjectId(userId);
  if (!oid) return empty;

  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const events = await ProfileViewEvent.find({
    user_id: oid,
    timestamp: { $gte: start },
  })
    .select('event_type visitor_id traffic_source timestamp cta_type')
    .lean();

  const visitors = new Set();
  const sources = { direct: 0, referral: 0, social: 0, search: 0, other: 0 };
  const counts = {
    profile_views: 0,
    chatbot_opens: 0,
    consultation_requests: 0,
    leads_generated: 0,
  };
  const dayMap = new Map();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    dayMap.set(dateKey(day), { date: dateKey(day), views: 0 });
  }

  for (const event of events) {
    const isView = event.event_type === 'profile_view';
    if (isView && event.visitor_id) visitors.add(String(event.visitor_id));
    if (isView) {
      const source = Object.prototype.hasOwnProperty.call(sources, event.traffic_source)
        ? event.traffic_source
        : 'other';
      sources[source] += 1;
    }
    if (isView) counts.profile_views += 1;
    if (event.event_type === 'chatbot_open') counts.chatbot_opens += 1;
    if (event.event_type === 'consultation_request') counts.consultation_requests += 1;
    if (event.event_type === 'cta_click' && event.cta_type === 'lead_created') counts.leads_generated += 1;
    const key = dateKey(event.timestamp);
    if (isView && dayMap.has(key)) {
      dayMap.get(key).views += 1;
    }
  }

  return {
    period_days: days,
    ...counts,
    chatbot_leads: Number(chatbotLeads || 0),
    form_leads: Number(formLeads || 0),
    unique_visitors: visitors.size,
    traffic_sources: sources,
    views_by_day: [...dayMap.values()],
  };
}

function serializePublicPage(publicProfile) {
  if (!publicProfile?.slug) return null;
  const published = publicProfile.storefront?.published || null;
  const publishedTemplateId = published?.template?.id || publicProfile.storefront?.active_template_id || null;
  return {
    slug: publicProfile.slug,
    path: `/p/${encodeURIComponent(publicProfile.slug)}`,
    enabled: publicProfile.enabled !== false,
    published: Boolean(published),
    published_at: published?.published_at || null,
    active_template_id: publishedTemplateId,
    headline: publicProfile.headline || '',
    cover_photo_url:
      publicProfile.cover_photo_url
      || published?.brandKit?.cover_url
      || '',
    profile_photo_url:
      publicProfile.profile_photo_url
      || published?.brandKit?.profile_photo_url
      || '',
    template_name: published?.template?.name || '',
  };
}

function serializeSubscription(subscription) {
  if (!subscription) return null;
  const plan = getPlan(subscription.plan_key);
  return {
    plan_key: subscription.plan_key || 'basic',
    plan_name: plan?.name || subscription.plan_key || 'Plan',
    display_amount: plan?.display_amount || '',
    interval: plan?.interval || 'month',
    status: subscription.status || '',
    trial_start: subscription.trial_start || null,
    trial_end: subscription.trial_end || null,
    current_period_start: subscription.current_period_start || null,
    current_period_end: subscription.current_period_end || null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    pending_plan_key: subscription.pending_plan_key || '',
    pending_plan_effective_at: subscription.pending_plan_effective_at || null,
    last_payment_status: subscription.last_payment_status || '',
    amount_cents: Number(plan?.amount || 0),
    createdAt: subscription.createdAt || null,
  };
}

function formatCents(cents, currency = 'usd') {
  const value = Number(cents) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'usd').toUpperCase(),
      maximumFractionDigits: value % 100 === 0 ? 0 : 2,
    }).format(value / 100);
  } catch {
    return `$${(value / 100).toFixed(0)}`;
  }
}

function inclusiveMonths(start, end = new Date()) {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || from > to) return 0;
  return Math.max(1, (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1);
}

function billingProfile(publicProfile, professionalType) {
  return {
    ...(publicProfile || { storefront: {} }),
    professional_type: publicProfile?.professional_type || professionalType || '',
  };
}

function buildBillingSummary(subscription, publicProfile, professionalType, invoices = []) {
  const items = [];
  const now = new Date();
  const inactiveStatuses = new Set(['canceled', 'cancelled', 'unpaid', 'incomplete', 'incomplete_expired']);

  if (subscription) {
    const plan = getPlan(subscription.plan_key);
    const amount = Number(plan?.amount || 0);
    const status = String(subscription.status || '').toLowerCase();
    const isTrial = status === 'free_trial' || status === 'trialing';
    const canceling = Boolean(subscription.cancel_at_period_end);
    const paidStart = !isTrial
      ? (subscription.trial_end || subscription.current_period_start || subscription.createdAt)
      : null;
    const spent = paidStart && amount > 0 ? amount * inclusiveMonths(paidStart, now) : 0;
    const willRenew = amount > 0
      && !canceling
      && !inactiveStatuses.has(status)
      && ['active', 'past_due', 'trialing', 'free_trial'].includes(status);
    items.push({
      id: 'platform',
      kind: 'platform',
      name: `${plan?.name || 'Plan'} plan`,
      amount_cents: amount,
      display_amount: plan?.display_amount || formatCents(amount),
      interval: plan?.interval || 'month',
      status,
      is_free: amount <= 0,
      is_trial: isTrial,
      cancel_at_period_end: canceling,
      renews_at: subscription.current_period_end || subscription.trial_end || null,
      expires_at: subscription.current_period_end || subscription.trial_end || null,
      spent_cents: spent,
      will_renew: willRenew,
    });
  }

  const purchases = Array.isArray(publicProfile?.storefront?.template_purchases)
    ? publicProfile.storefront.template_purchases
    : [];
  const latestByTemplate = new Map();
  purchases.forEach((purchase) => {
    const templateId = normalizeTemplateId(purchase.template_id);
    if (!templateId) return;
    const existing = latestByTemplate.get(templateId);
    if (!existing || new Date(purchase.purchased_at || 0) >= new Date(existing.purchased_at || 0)) {
      latestByTemplate.set(templateId, purchase);
    }
  });

  const publishedId = normalizeTemplateId(
    publicProfile?.storefront?.published?.template?.id
      || publicProfile?.storefront?.active_template_id,
  );
  const entitlements = serializeStorefrontTemplateEntitlements(
    billingProfile(publicProfile, professionalType),
  );

  entitlements.templates.forEach((template) => {
    if (!template.unlocked) return;
    if (latestByTemplate.has(template.template_id)) return;
    items.push({
      id: `template-${template.template_id}`,
      kind: 'template',
      name: template.name,
      amount_cents: Number(template.amount || 0),
      display_amount: template.display_amount || 'Free',
      interval: template.interval || 'month',
      status: 'included',
      is_free: Number(template.amount || 0) <= 0,
      is_trial: false,
      is_published: template.template_id === publishedId,
      cancel_at_period_end: false,
      renews_at: null,
      spent_cents: 0,
      will_renew: false,
    });
  });

  latestByTemplate.forEach((purchase, templateId) => {
    const catalog = getStorefrontTemplateTier(templateId);
    const amount = Number(purchase.amount || catalog?.amount || 0);
    const hasSub = Boolean(String(purchase.stripe_subscription_id || '').trim());
    const periodEnd = templatePurchasePeriodEnd(purchase);
    const periodEndDate = periodEnd ? new Date(periodEnd) : null;
    const periodValid = periodEndDate && !Number.isNaN(periodEndDate.getTime());
    const canceling = Boolean(purchase.cancel_at_period_end);
    const monthly = amount > 0;
    const rawStatus = String(purchase.subscription_status || '').toLowerCase();
    const liveStatus = rawStatus === 'lifetime' ? 'active' : (rawStatus || (monthly ? 'active' : 'included'));
    const expired = monthly && !hasSub && periodValid && periodEndDate < now;
    const status = expired ? 'expired' : liveStatus;
    const willRenew = monthly
      && hasSub
      && !expired
      && !canceling
      && !inactiveStatuses.has(status);
    let spent = 0;
    if (amount > 0 && purchase.purchased_at) {
      spent = amount * inclusiveMonths(purchase.purchased_at, expired ? periodEndDate : now);
    }
    items.push({
      id: `template-${templateId}`,
      kind: 'template',
      name: catalog?.name || templateId,
      amount_cents: amount,
      display_amount: amount > 0 ? formatCents(amount) : 'Free',
      interval: purchase.billing_interval || catalog?.interval || 'month',
      status,
      is_free: amount <= 0,
      is_trial: false,
      is_published: templateId === publishedId,
      cancel_at_period_end: canceling,
      renews_at: periodValid && !expired ? periodEndDate : null,
      expires_at: periodValid ? periodEndDate : null,
      spent_cents: spent,
      will_renew: willRenew,
    });
  });

  const totalSpent = items.reduce((sum, item) => sum + Number(item.spent_cents || 0), 0);
  const invoiceSpent = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.amountPaid || invoice.amount_paid || 0),
    0,
  );
  const spentCents = invoiceSpent > 0 ? invoiceSpent : totalSpent;
  const nextItems = items.filter((item) => item.will_renew);
  const nextExpected = nextItems.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
  const nextDates = nextItems
    .map((item) => (item.renews_at ? new Date(item.renews_at) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()));

  return {
    currency: 'usd',
    total_spent_cents: spentCents,
    total_spent: formatCents(spentCents),
    next_expected_cents: nextExpected,
    next_expected: formatCents(nextExpected),
    next_expected_at: nextDates.length
      ? new Date(Math.min(...nextDates.map((date) => date.getTime())))
      : null,
    active_count: items.filter((item) => item.will_renew).length,
    items,
    invoices,
  };
}

function serializeTemplates(publicProfile, professionalType) {
  const source = billingProfile(publicProfile, professionalType);
  const entitlements = serializeStorefrontTemplateEntitlements(source);
  const purchases = Array.isArray(source.storefront?.template_purchases)
    ? source.storefront.template_purchases
    : [];
  const publishedId = normalizeTemplateId(
    publicProfile?.storefront?.published?.template?.id
      || publicProfile?.storefront?.active_template_id,
  );
  const owned = entitlements.templates
    .filter((template) => template.unlocked || template.subscription)
    .map((template) => {
      const purchase = [...purchases]
        .reverse()
        .find((row) => normalizeTemplateId(row.template_id) === template.template_id);
      return {
        template_id: template.template_id,
        name: template.name,
        tier: template.tier,
        display_amount: template.display_amount,
        unlocked: Boolean(template.unlocked),
        is_free: Number(template.amount || 0) <= 0,
        is_published: template.template_id === publishedId,
        subscription: template.subscription,
        purchased_at: purchase?.purchased_at || null,
      };
    });
  return {
    owned,
    unlocked_count: entitlements.unlocked_template_ids.length,
    catalog_count: entitlements.templates.length,
  };
}

const LIST_SELECT =
  'user_id professional_type full_name company_name phone location website license_number credential_status country jurisdiction createdAt updatedAt';

export async function listAdminProfessionalsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const and = [];
  if (query.professional_type) and.push({ professional_type: query.professional_type });
  if (query.credential_status && CREDENTIAL_STATUS_VALUES.includes(query.credential_status)) {
    and.push({ credential_status: query.credential_status });
  }
  const dateFilter = {};
  applyDateRange(dateFilter, query, 'createdAt');
  if (dateFilter.createdAt) and.push({ createdAt: dateFilter.createdAt });

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    const userIds = await findUserIdsBySearch(query.q);
    and.push({
      $or: [
        { full_name: rx },
        { company_name: rx },
        { phone: rx },
        { location: rx },
        ...(userIds?.length ? [{ user_id: { $in: userIds } }] : []),
      ],
    });
  }

  if (query.status === 'active' || query.status === 'suspended') {
    const users = await User.find({
      is_active: query.status === 'active' ? { $ne: false } : false,
    })
      .select('_id')
      .lean();
    and.push({ user_id: { $in: users.map((u) => u._id) } });
  }

  const filter = and.length ? { $and: and } : {};
  const sort = parseSort(query, ['createdAt', 'updatedAt', 'full_name'], { updatedAt: -1 });

  const [items, total] = await Promise.all([
    ProfessionalProfile.find(filter)
      .select(LIST_SELECT)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user_id', USER_LIST)
      .lean(),
    ProfessionalProfile.countDocuments(filter),
  ]);

  return ok({
    items: items.map((row) => ({
      id: String(row._id),
      user: serializeUser(row.user_id),
      professional_type: row.professional_type,
      full_name: row.full_name || '',
      company_name: row.company_name || '',
      phone: row.phone || '',
      location: row.location || '',
      website: row.website || '',
      license_number: row.license_number || '',
      credential_status: row.credential_status || null,
      country: row.country || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}

export async function getAdminProfessionalService(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid professional id');
  const profile = await ProfessionalProfile.findById(id)
    .populate('user_id', USER_PUBLIC)
    .lean();
  if (!profile) return fail(404, 'Professional not found');

  const userId = profile.user_id?._id || profile.user_id;
  // Stripe reconcile stays in the background so this page is not gated on it.
  refreshStorefrontTemplateSubscriptionsForUser(userId).catch(() => null);
  repairPlatformSubscriptionIfTemplateCollision(userId).catch(() => null);

  const [
    leadInsights,
    referrals,
    subscription,
    verification,
    publicProfile,
    invoices,
    trafficBase,
  ] = await Promise.all([
    loadLeadInsights(userId, profile._id),
    countReferrals(userId),
    Subscription.findOne({ user_id: userId }).lean(),
    serializeCredentialStateAsync(profile, profile.user_id?.role || profile.professional_type, {
      audience: 'admin',
    }),
    PublicProfile.findOne({ user_id: userId })
      .select('slug enabled headline cover_photo_url profile_photo_url storefront.published storefront.active_template_id storefront.template_purchases storefront.unlocked_template_ids professional_type')
      .lean(),
    listPaidInvoicesForUser({ _id: userId }, 40).catch(() => []),
    summarizePageTraffic(userId),
  ]);

  const traffic = {
    ...trafficBase,
    chatbot_leads: Number(leadInsights.chatbotLeads || 0),
    form_leads: Number(leadInsights.formLeads || 0),
  };

  const completeness = evaluateProfessionalProfileSetup(profile.user_id, {
    ...profile,
    phone: profile.phone || profile.user_id?.phone || '',
  });
  const templates = serializeTemplates(publicProfile, profile.professional_type);
  const billing = buildBillingSummary(subscription, publicProfile, profile.professional_type, invoices);
  const {
    user_id: _userId,
    credential_events: _events,
    credential_documents: _docs,
    ...professionalFields
  } = profile;
  const leadOutcomes = leadInsights.outcomes;

  return ok({
    professional: {
      ...professionalFields,
      id: String(profile._id),
      user: serializeUser(profile.user_id),
    },
    verification,
    documents: (verification.documents || []).map((doc) => ({
      id: doc.id,
      type: doc.type,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      uploaded_at: doc.uploaded_at,
      status: doc.status,
    })),
    public_page: serializePublicPage(publicProfile),
    subscription: serializeSubscription(subscription),
    billing,
    templates,
    traffic,
    completeness: {
      is_complete: Boolean(completeness?.is_complete),
      personal_complete: Boolean(completeness?.personal_complete),
      business_complete: Boolean(completeness?.business_complete),
      missing_fields: completeness?.missing_fields || [],
    },
    stats: {
      leads_owned: leadOutcomes.total,
      leads_open: leadOutcomes.open,
      leads_won: leadOutcomes.won,
      leads_lost: leadOutcomes.lost,
      leads_closed: leadOutcomes.closed,
      leads_by_status: leadOutcomes.by_status,
      referrals_sent: referrals.sent,
      referrals_received: referrals.received,
      page_views: traffic.profile_views,
      unique_visitors: traffic.unique_visitors,
      chatbot_leads: traffic.chatbot_leads,
      form_leads: traffic.form_leads,
    },
    recent_leads: leadInsights.recentLeads.map((lead) => ({
      id: String(lead._id),
      lead_type: lead.lead_type || '',
      match_status: lead.match_status || '',
      createdAt: lead.createdAt,
      title:
        lead.compatibility_factors?.property_inquiry?.title
        || lead.compatibility_factors?.client_profile?.full_name
        || lead.lead_type
        || 'Lead',
    })),
  });
}

export async function patchAdminProfessionalService(id, patch = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid professional id');
  const profile = await ProfessionalProfile.findById(id);
  if (!profile) return fail(404, 'Professional not found');

  for (const key of ['full_name', 'company_name', 'phone', 'location', 'professional_type', 'website', 'license_number']) {
    if (patch[key] !== undefined) profile[key] = patch[key];
  }
  await profile.save();
  return getAdminProfessionalService(id);
}

