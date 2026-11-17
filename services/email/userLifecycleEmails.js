import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { EMAIL_BRAND, EMAIL_FONT, EMAIL_GREEN_CTA_STYLE, EMAIL_LINK_STYLE, renderBrandedEmailShell } from './emailTheme.js';
import { supportContactUrl, supportEmail } from '../../constants/support.js';

/** Email HTML for the account owner: welcome, credentials approved, credentials need updates. */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function appBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

// Same layout as the other Nesti account emails (see authEmail.js and accountStatusNotifications.js):
// branded shell, "Nesti AI" kicker, a heading in the body, short paragraphs, one green button.
const H1 = `margin:0 0 12px;font-family:${EMAIL_FONT.heading};font-size:22px;line-height:1.3;color:${EMAIL_BRAND.heading};`;
const P = `margin:0 0 14px;font-size:14px;line-height:1.6;color:${EMAIL_BRAND.body};`;
const LABEL = `margin:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_BRAND.primaryDark};`;
const NOTE = `margin:18px 0 0;font-size:12px;line-height:1.55;color:${EMAIL_BRAND.muted};`;

function greeting(firstName) {
  const name = String(firstName || '').trim();
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${EMAIL_BRAND.heading};">${name ? `Hi ${escapeHtml(name)},` : 'Hi,'}</p>`;
}

function button(href, label) {
  return `<p style="margin:22px 0 0;"><a href="${escapeHtml(href)}" style="${EMAIL_GREEN_CTA_STYLE}">${escapeHtml(label)}</a></p>
    <p style="margin:12px 0 0;font-size:12px;line-height:1.55;color:${EMAIL_BRAND.muted};">Or open this link: <a href="${escapeHtml(href)}" style="${EMAIL_LINK_STYLE}">${escapeHtml(href)}</a></p>`;
}

/** Numbered steps in a soft green panel, matching the code box in the sign-up email. */
function stepsPanel(steps = []) {
  const rows = steps
    .map((step, index) => `<tr>
        <td style="width:28px;vertical-align:top;padding:6px 0;"><div style="height:22px;width:22px;border-radius:999px;background:${EMAIL_BRAND.primaryDark};color:#ffffff;font-family:${EMAIL_FONT.heading};font-size:12px;font-weight:700;line-height:22px;text-align:center;">${index + 1}</div></td>
        <td style="vertical-align:top;padding:6px 0 6px 8px;font-size:14px;line-height:1.5;color:${EMAIL_BRAND.heading};"><strong>${escapeHtml(step.title)}</strong>${step.detail ? `<div style="font-size:13px;color:${EMAIL_BRAND.body};margin-top:2px;">${escapeHtml(step.detail)}</div>` : ''}</td>
      </tr>`)
    .join('');
  return `<div style="margin:0 0 4px;padding:12px 16px;border:1px solid #bdecc8;border-radius:10px;background:#f2fff6;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>`;
}

function shell({ title, headline, innerHtml }) {
  return renderBrandedEmailShell({
    kicker: 'Nesti AI',
    title,
    innerHtml: `<h1 style="${H1}">${escapeHtml(headline)}</h1>${innerHtml}`,
    maxWidth: 560,
    headerBgColor: EMAIL_BRAND.primaryDark,
  });
}

/** "Need help?" line: the support form and support email (the sending inbox is not monitored). */
function supportNote(lead = 'Need help?') {
  const url = supportContactUrl();
  const email = supportEmail();
  return `<p style="${NOTE}">${escapeHtml(lead)} Contact Nesti support through the <a href="${escapeHtml(url)}" style="${EMAIL_LINK_STYLE}">support form</a> or at <a href="mailto:${escapeHtml(email)}" style="${EMAIL_LINK_STYLE}">${escapeHtml(email)}</a>.</p>`;
}

function supportText(lead = 'Need help?') {
  return `${lead} Contact Nesti support at ${supportEmail()} or through the support form: ${supportContactUrl()}`;
}

function plainText(lines) {
  return lines.filter((line) => line !== null && line !== undefined && line !== '').join('\n\n');
}

const PROFESSIONAL_ROLES = new Set(['agent', 'mortgage_broker', 'lawyer']);

const ROLE_WELCOME = {
  agent: {
    label: 'real estate agent',
    intro: 'Your Nesti workspace is ready. Nesti matches you with buyers and sellers in your service areas, gives you a public Web Page, and a website chatbot that captures leads for you.',
    business: 'Company, office, service areas, specialties and languages.',
    credentials: 'Your real estate license and a government ID.',
  },
  mortgage_broker: {
    label: 'mortgage broker',
    intro: 'Your Nesti workspace is ready. Nesti matches you with home buyers who need financing, gives you a public Web Page, and a website chatbot that captures leads for you.',
    business: 'Brokerage, office, service areas, specialties and languages.',
    credentials: 'Your mortgage license and a government ID.',
  },
  lawyer: {
    label: 'real estate lawyer',
    intro: 'Your Nesti workspace is ready. Nesti connects you with buyers and sellers who need closing and legal support, gives you a public Web Page, and a website chatbot that captures leads for you.',
    business: 'Firm, office, service areas, practice areas and languages.',
    credentials: 'Your law society or bar license and a government ID.',
  },
};

export function renderWelcomeEmail({ firstName = '', role = '' } = {}) {
  const key = String(role || '').toLowerCase();
  const base = appBaseUrl();
  if (PROFESSIONAL_ROLES.has(key)) {
    const copy = ROLE_WELCOME[key];
    const href = `${base}/settings?tab=personal`;
    const steps = [
      { title: 'Personal information', detail: 'Your name, phone and photo.' },
      { title: 'Business details', detail: copy.business },
      { title: 'License & Credentials', detail: copy.credentials },
    ];
    const innerHtml = `${greeting(firstName)}
      <p style="${P}">${escapeHtml(copy.intro)}</p>
      <p style="${LABEL}">Finish your setup</p>
      ${stepsPanel(steps)}
      <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:${EMAIL_BRAND.body};">Once our team approves your license and credentials, your free trial starts and your workspace unlocks: the AI website chatbot, the Web Page editor with a hosted page, and lead capture and matching. We'll email your subscription details then.</p>
      ${button(href, 'Finish setup')}
      <p style="${NOTE}">You signed up as a ${escapeHtml(copy.label)}. If you didn't create this account, you can ignore this email.</p>`;
    return {
      subject: 'Welcome to Nesti AI',
      html: shell({ title: 'Welcome to Nesti', headline: 'Your account is ready', innerHtml }),
      text: plainText([
        firstName ? `Hi ${String(firstName).trim()},` : 'Hi,',
        copy.intro,
        `Finish your setup:\n1. Personal information\n2. Business details\n3. License & Credentials`,
        'Once our team approves your license and credentials, your free trial starts and your workspace unlocks: the AI website chatbot, the Web Page editor with a hosted page, and lead capture and matching. We will email your subscription details then.',
        `Finish setup: ${href}`,
      ]),
    };
  }
  const href = `${base}/client-dashboard`;
  const steps = [
    { title: 'Complete your profile', detail: 'Budget, savings, timeline and the areas you like.' },
    { title: 'Get matched', detail: 'See agents, mortgage brokers and lawyers who fit your goals.' },
    { title: 'Reach out', detail: 'Message or book a call with a professional from your dashboard.' },
  ];
  const intro = 'Your Nesti account is ready. Tell us about your home goals and we will match you with the right professionals and properties.';
  const innerHtml = `${greeting(firstName)}
    <p style="${P}">${escapeHtml(intro)}</p>
    <p style="${LABEL}">How it works</p>
    ${stepsPanel(steps)}
    ${button(href, 'Open your dashboard')}
    <p style="${NOTE}">If you didn't create this account, you can ignore this email.</p>`;
  return {
    subject: 'Welcome to Nesti AI',
    html: shell({ title: 'Welcome to Nesti', headline: 'Your account is ready', innerHtml }),
    text: plainText([
      firstName ? `Hi ${String(firstName).trim()},` : 'Hi,',
      intro,
      `Open your dashboard: ${href}`,
    ]),
  };
}

/** Role-specific copy for the approval, review and account status emails. Only services the code really offers. */
const ROLE_APPROVED = {
  agent: {
    label: 'real estate agent',
    intro: 'You can now take buyer, seller and investor leads in your service areas.',
    chatbot: 'Talks with buyers, sellers and investors on your website, asks your qualifying questions and captures each lead.',
    leads: 'Buyer, seller and investor leads from your chatbot and Web Page are scored and matched to you by service area and your Ideal Client Profile.',
    calendar: 'Connect Calendly so clients can book showings and consultations with you.',
    referrals: 'Refer clients to mortgage brokers and lawyers on Nesti and track every referral.',
    propertyMatches: true,
  },
  mortgage_broker: {
    label: 'mortgage broker',
    intro: 'You can now take leads from home buyers who need financing in your service areas.',
    chatbot: 'Talks with home buyers on your website, asks your qualifying questions and captures each lead with an affordability snapshot.',
    leads: 'Buyers who need financing are scored and matched to you by service area and your Ideal Client Profile.',
    calendar: 'Connect Calendly so buyers can book a mortgage consultation with you.',
    referrals: 'Refer clients to agents and lawyers on Nesti and track every referral.',
    propertyMatches: false,
  },
  lawyer: {
    label: 'real estate lawyer',
    intro: 'You can now take leads from buyers and sellers who need closing and legal support in your service areas.',
    chatbot: 'Talks with buyers and sellers on your website, collects the property and closing details you need and captures each lead.',
    leads: 'Buyers and sellers who need closing or legal support are scored and matched to you by service area and your Ideal Client Profile.',
    calendar: 'Connect Calendly so clients can book a consultation with you.',
    referrals: 'Refer clients to agents and mortgage brokers on Nesti and track every referral.',
    propertyMatches: false,
  },
};

const DEFAULT_APPROVED = {
  label: 'professional',
  intro: 'You can now take leads in your service areas.',
  chatbot: 'Answers visitors on your website, asks your qualifying questions and captures each lead.',
  leads: 'Leads from your chatbot and Web Page are scored and matched to you by service area and your Ideal Client Profile.',
  calendar: 'Connect Calendly so clients can book consultations with you.',
  referrals: 'Refer clients to other professionals on Nesti and track every referral.',
  propertyMatches: false,
};

function roleCopy(role) {
  return ROLE_APPROVED[String(role || '').toLowerCase()] || DEFAULT_APPROVED;
}

function credentialsLine(role) {
  return ROLE_WELCOME[String(role || '').toLowerCase()]?.credentials || 'Your license and a government ID.';
}

function formatEmailDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const PLAN_LABELS = { basic: 'Basic', standard: 'Standard', enterprise: 'Enterprise' };

/** Label/value rows in a soft green panel (subscription summary). */
function detailsPanel(heading, rows) {
  const body = rows
    .map(([label, value]) => `<tr>
        <td style="padding:5px 0;font-size:13px;color:${EMAIL_BRAND.muted};width:42%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:5px 0;font-size:14px;color:${EMAIL_BRAND.heading};font-weight:600;vertical-align:top;">${escapeHtml(value)}</td>
      </tr>`)
    .join('');
  return `<div style="margin:0 0 4px;padding:14px 16px;border:1px solid #bdecc8;border-radius:10px;background:#f2fff6;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_BRAND.primaryDark};margin-bottom:6px;">${escapeHtml(heading)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
    </div>`;
}

/** Service rows: icon tile, name, one line, link, and an "included" tag. */
function servicesList(services) {
  const rows = services
    .map((svc) => `<tr>
        <td style="width:44px;vertical-align:top;padding:10px 0;"><div style="height:34px;width:34px;border-radius:9px;background:#f2fff6;border:1px solid #bdecc8;font-size:17px;line-height:34px;text-align:center;">${svc.icon}</div></td>
        <td style="vertical-align:top;padding:10px 0 10px 10px;border-bottom:1px solid #edf2f7;">
          <div style="font-size:14px;font-weight:700;color:${EMAIL_BRAND.heading};">${escapeHtml(svc.name)}
            <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:700;vertical-align:1px;${svc.included ? `background:#e8f6ec;color:${EMAIL_BRAND.primaryDark};` : `background:#f1f5f9;color:${EMAIL_BRAND.muted};`}">${escapeHtml(svc.included ? 'Included' : svc.planNote || 'Upgrade')}</span>
          </div>
          <div style="margin-top:3px;font-size:13px;line-height:1.5;color:${EMAIL_BRAND.body};">${escapeHtml(svc.detail)}</div>
          <div style="margin-top:4px;font-size:13px;"><a href="${escapeHtml(svc.href)}" style="${EMAIL_LINK_STYLE}">${escapeHtml(svc.linkLabel)}</a></div>
        </td>
      </tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

/**
 * Sent when the license and credentials are approved and the free trial starts.
 * `features` says what the current plan includes; `plans` is the public price list (USD).
 */
export function renderCredentialsApprovedEmail({
  firstName = '',
  trialDays = 14,
  trialEnd = null,
  trialStart = null,
  planKey = 'basic',
  status = 'free_trial',
  publicUrl = '',
  features = {},
  plans = [],
  role = '',
  templates = null,
} = {}) {
  const base = appBaseUrl();
  const copy = roleCopy(role);
  const ends = formatEmailDate(trialEnd);
  const starts = formatEmailDate(trialStart);
  const onTrial = String(status || '').toLowerCase() === 'free_trial';
  const planName = PLAN_LABELS[String(planKey || '').toLowerCase()] || 'Basic';
  const subscriptionHref = `${base}/settings?tab=subscription`;

  const detailRows = [
    ['Plan', onTrial ? `Free trial (${planName} features)` : planName],
    ...(onTrial ? [['Trial length', `${trialDays} days`]] : []),
    ...(starts ? [['Started', starts]] : []),
    ...(ends ? [[onTrial ? 'Trial ends' : 'Renews', ends]] : []),
    ...plans
      .filter((plan) => plan?.name && plan?.display_amount)
      .map((plan) => [`${plan.name} plan`, `${plan.display_amount} USD / month`]),
  ];

  const templateCount = Number(templates?.total) || 0;
  const freeTemplates = Number(templates?.free) || 0;
  const editorDetail = templateCount
    ? `Build your page from ${templateCount} ${copy.label} templates (${freeTemplates || 1} free): about, services, testimonials and contact.`
    : 'Build your page from a template: about, services, testimonials and contact.';
  const services = [
    {
      icon: '&#128172;',
      name: 'AI website chatbot',
      detail: `${copy.chatbot} Copy the embed code and add it to your website.`,
      href: `${base}/settings?tab=chatbot`,
      linkLabel: 'Set up your chatbot',
      included: features.chatbot !== false,
    },
    {
      icon: '&#127912;',
      name: 'Chatbot customization',
      detail: 'Your assistant\'s greeting, tone, appearance, documents and follow-up style.',
      href: `${base}/settings?tab=chatbot`,
      linkLabel: 'Customize your assistant',
      included: Boolean(features.assistant),
      planNote: 'Standard and Enterprise',
    },
    ...(copy.propertyMatches
      ? [{
        icon: '&#127968;',
        name: 'Property suggestions in chat',
        detail: 'Your chatbot can show buyers matching properties while they chat.',
        href: `${base}/settings?tab=chatbot`,
        linkLabel: 'Manage property suggestions',
        included: Boolean(features.propertyMatches),
        planNote: 'Standard and Enterprise',
      }]
      : []),
    {
      icon: '&#127760;',
      name: 'Web Page editor',
      detail: editorDetail,
      href: `${base}/dashboard/public-profile`,
      linkLabel: 'Open the Web Page editor',
      included: true,
    },
    {
      icon: '&#128279;',
      name: 'Hosted Web Page',
      detail: publicUrl
        ? `Your page is hosted by Nesti at ${publicUrl}. Publish it from the editor and share the link.`
        : 'Nesti hosts your page at your own link. Publish it from the editor and share the link.',
      href: publicUrl || `${base}/dashboard/public-profile`,
      linkLabel: publicUrl ? 'View your Web Page' : 'Publish your Web Page',
      included: true,
    },
    {
      icon: '&#127919;',
      name: 'Lead capture and matching',
      detail: copy.leads,
      href: `${base}/leads`,
      linkLabel: 'View your leads',
      included: features.leads !== false,
    },
    {
      icon: '&#129309;',
      name: 'Referrals',
      detail: copy.referrals,
      href: `${base}/referrals`,
      linkLabel: 'Open referrals',
      included: features.referrals !== false,
      planNote: 'Upgrade',
    },
    {
      icon: '&#128197;',
      name: 'Calendar and Calendly booking',
      detail: copy.calendar,
      href: `${base}/calendar`,
      linkLabel: 'Connect your calendar',
      included: Boolean(features.calendar),
      planNote: 'Standard and Enterprise',
    },
    {
      icon: '&#128222;',
      name: 'AI voice agent',
      detail: 'Answers and logs calls for you, with call history.',
      href: features.voice ? `${base}/call-history` : subscriptionHref,
      linkLabel: features.voice ? 'Open call history' : 'See plans',
      included: Boolean(features.voice),
      planNote: 'Enterprise',
    },
  ];

  const trialSentence = onTrial
    ? `Your ${trialDays}-day free trial has started${ends ? ` and runs until ${ends}` : ''}.`
    : `Your ${planName} plan is active.`;
  const innerHtml = `${greeting(firstName)}
    <p style="${P}">Your license and credentials have been approved, and your ${escapeHtml(copy.label)} workspace is unlocked. ${escapeHtml(copy.intro)} ${escapeHtml(trialSentence)}</p>
    ${detailsPanel('Your subscription', detailRows)}
    <p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:${EMAIL_BRAND.body};">${onTrial ? 'Choose a plan any time before the trial ends to keep every service running. ' : ''}Your Web Page stays available, and you can keep editing and republishing it on a free template even without a paid plan.</p>
    <p style="margin:8px 0 0;font-size:13px;"><a href="${escapeHtml(subscriptionHref)}" style="${EMAIL_LINK_STYLE}">Manage your subscription</a></p>
    <p style="${LABEL}">Your services</p>
    ${servicesList(services)}
    ${button(`${base}/dashboard`, 'Open your dashboard')}
    ${supportNote()}`;

  const text = plainText([
    firstName ? `Hi ${String(firstName).trim()},` : 'Hi,',
    `Your license and credentials have been approved, and your ${copy.label} workspace is unlocked. ${copy.intro} ${trialSentence}`,
    `Your subscription\n${detailRows.map(([label, value]) => `- ${label}: ${value}`).join('\n')}`,
    `${onTrial ? 'Choose a plan any time before the trial ends to keep every service running. ' : ''}Your Web Page stays available, and you can keep editing and republishing it on a free template. Manage your subscription: ${subscriptionHref}`,
    `Your services\n${services
      .map((svc) => `- ${svc.name} (${svc.included ? 'Included' : svc.planNote || 'Upgrade'}): ${svc.detail} ${svc.href}`)
      .join('\n')}`,
    `Open your dashboard: ${base}/dashboard`,
    supportText(),
  ]);

  return {
    subject: onTrial ? 'You\'re approved: your Nesti free trial has started' : 'Your credentials are approved',
    html: shell({ title: 'License & Credentials', headline: 'Credentials approved', innerHtml }),
    text,
  };
}

export function renderCredentialsNeedUpdatesEmail({ firstName = '', reason = '', fileLabels = [], role = '' } = {}) {
  const files = (Array.isArray(fileLabels) ? fileLabels : []).filter(Boolean);
  const href = `${appBaseUrl()}/settings?tab=verification`;
  const copy = roleCopy(role);
  const note = String(reason || '').trim();
  const filesBlock = files.length
    ? `<p style="${LABEL}">Files to upload again</p>
       <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:${EMAIL_BRAND.body};">${files.map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul>
       <p style="margin:8px 0 0;font-size:13px;color:${EMAIL_BRAND.muted};">Your other files are kept.</p>`
    : `<p style="margin:16px 0 0;font-size:14px;color:${EMAIL_BRAND.body};">Please upload all of your documents again.</p>`;
  const steps = [
    { title: 'Open License & Credentials', detail: 'Sign in and go to Settings, License & Credentials.' },
    files.length
      ? { title: 'Upload the files listed above', detail: 'Use clear, full-page photos or PDFs.' }
      : { title: 'Upload your documents again', detail: credentialsLine(role) },
    { title: 'Submit for review', detail: 'We will email you as soon as our team has reviewed it.' },
  ];
  const innerHtml = `${greeting(firstName)}
    <p style="${P}">Our team reviewed your ${escapeHtml(copy.label)} license and credentials and needs a few updates before they can be approved. Your free trial and workspace start as soon as they are approved.</p>
    <p style="${LABEL}">Reviewer's note</p>
    <p style="margin:0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid ${EMAIL_BRAND.border};font-size:14px;line-height:1.55;color:${EMAIL_BRAND.heading};white-space:pre-line;">${escapeHtml(note) || 'No note was added.'}</p>
    ${filesBlock}
    <p style="${LABEL}">Next steps</p>
    ${stepsPanel(steps)}
    ${button(href, 'Update License & Credentials')}
    ${supportNote('Questions about this review?')}`;
  return {
    subject: 'Your credentials need updates',
    html: shell({ title: 'License & Credentials', headline: 'Updates needed', innerHtml }),
    text: plainText([
      firstName ? `Hi ${String(firstName).trim()},` : 'Hi,',
      `Our team reviewed your ${copy.label} license and credentials and needs a few updates before they can be approved. Your free trial and workspace start as soon as they are approved.`,
      `Reviewer's note: ${note || 'No note was added.'}`,
      files.length ? `Files to upload again: ${files.join(', ')}. Your other files are kept.` : 'Please upload all of your documents again.',
      `Next steps:\n${steps.map((step, i) => `${i + 1}. ${step.title}: ${step.detail}`).join('\n')}`,
      `Update License & Credentials: ${href}`,
      supportText('Questions about this review?'),
    ]),
  };
}

const PRO_SUSPENDED_EFFECTS = [
  { title: 'Sign-in is paused', detail: 'You cannot sign in, and any open sessions were signed out.' },
  { title: 'Your website chatbot is paused', detail: 'It tells visitors the assistant is not available and does not capture new leads.' },
  { title: 'Your Web Page is offline', detail: 'Your public page and directory listing are hidden. Clients cannot send you new requests through Nesti.' },
  { title: 'Your data is kept', detail: 'Your leads, conversations, Web Page and settings are not deleted.' },
];

const CLIENT_SUSPENDED_EFFECTS = [
  { title: 'Sign-in is paused', detail: 'You cannot sign in, and any open sessions were signed out.' },
  { title: 'Your data is kept', detail: 'Your profile, matches and messages are not deleted.' },
];

/** Account status emails (admin suspend / reinstate). Returns { subject, html, text }. */
export function renderAccountSuspendedEmail({ firstName = '', reason = '', role = '' } = {}) {
  const key = String(role || '').toLowerCase();
  const isPro = PROFESSIONAL_ROLES.has(key);
  const effects = isPro ? PRO_SUSPENDED_EFFECTS : CLIENT_SUSPENDED_EFFECTS;
  const cleanReason = String(reason || '').trim();
  const accountLabel = isPro ? `${roleCopy(key).label} account` : 'account';
  const resolve = [
    ...(cleanReason ? [{ title: 'Review the reason', detail: 'See the note from our team above.' }] : []),
    { title: 'Contact Nesti support', detail: `Email ${supportEmail()} or use the support form, and include any details or documents that help resolve it.` },
    { title: 'We will let you know', detail: 'You will get an email as soon as access is restored.' },
  ];
  const innerHtml = `${greeting(firstName)}
    <p style="${P}">Your Nesti ${escapeHtml(accountLabel)} has been suspended. You will not be able to sign in until an administrator restores access.</p>
    ${cleanReason ? `<p style="${LABEL}">Reason provided</p>
    <p style="margin:0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid ${EMAIL_BRAND.border};font-size:14px;line-height:1.55;color:${EMAIL_BRAND.heading};white-space:pre-line;">${escapeHtml(cleanReason)}</p>` : ''}
    <p style="${LABEL}">What this means</p>
    ${stepsPanel(effects)}
    <p style="${LABEL}">How to resolve it</p>
    ${stepsPanel(resolve)}
    ${button(supportContactUrl(), 'Contact support')}
    ${supportNote('Think this is a mistake?')}`;
  return {
    subject: 'Your Nesti account has been suspended',
    html: renderBrandedEmailShell({
      kicker: 'Nesti AI',
      title: 'Account status',
      innerHtml: `<h1 style="${H1}">Your account is suspended</h1>${innerHtml}`,
      maxWidth: 560,
      headerBgColor: EMAIL_BRAND.primaryDark,
    }),
    text: plainText([
      firstName ? `Hi ${String(firstName).trim()},` : 'Hi,',
      `Your Nesti ${accountLabel} has been suspended. You will not be able to sign in until an administrator restores access.`,
      cleanReason ? `Reason provided: ${cleanReason}` : '',
      `What this means:\n${effects.map((e) => `- ${e.title}: ${e.detail}`).join('\n')}`,
      `How to resolve it:\n${resolve.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`).join('\n')}`,
      supportText('Think this is a mistake?'),
    ]),
  };
}

export function renderAccountReinstatedEmail({ firstName = '', role = '' } = {}) {
  const isPro = PROFESSIONAL_ROLES.has(String(role || '').toLowerCase());
  const loginUrl = `${appBaseUrl()}/log-in`;
  const back = isPro
    ? 'Your website chatbot takes chats and leads again, and your Web Page is back online on your current plan.'
    : '';
  const innerHtml = `${greeting(firstName)}
    <p style="${P}">Your Nesti account has been reinstated. You can sign in again and continue using your workspace.</p>
    ${back ? `<p style="${P}">${escapeHtml(back)}</p>` : ''}
    ${button(loginUrl, 'Sign in')}
    ${supportNote()}`;
  return {
    subject: 'Your Nesti account has been reinstated',
    html: renderBrandedEmailShell({
      kicker: 'Nesti AI',
      title: 'Account status',
      innerHtml: `<h1 style="${H1}">Your account has been reinstated</h1>${innerHtml}`,
      maxWidth: 560,
      headerBgColor: EMAIL_BRAND.primaryDark,
    }),
    text: plainText([
      firstName ? `Hi ${String(firstName).trim()},` : 'Hi,',
      `Your Nesti account has been reinstated. You can sign in again and continue using your workspace.${back ? ` ${back}` : ''}`,
      `Sign in: ${loginUrl}`,
      supportText(),
    ]),
  };
}

/** Sends the welcome email once an account is verified. Never throws; failures are logged. */
export async function sendWelcomeEmail(user) {
  const to = String(user?.email || '').trim();
  if (!to || String(user?.role || '').toLowerCase() === 'admin') return { email_status: 'skipped' };
  try {
    const { subject, html, text } = renderWelcomeEmail({ firstName: user.first_name, role: user.role });
    const result = await sendEmail({
      email: to,
      subject,
      message: text,
      htmlMessage: html,
      replyTo: supportEmail(),
      idempotencyKey: `welcome-${String(user._id || to)}`,
    });
    if (result && result.success === false) {
      logger.warn('Welcome email failed', { error: result.error?.message || 'unknown' });
      return { email_status: 'failed' };
    }
    return { email_status: 'sent' };
  } catch (error) {
    logger.warn('Welcome email failed', { error: error?.message });
    return { email_status: 'failed' };
  }
}
