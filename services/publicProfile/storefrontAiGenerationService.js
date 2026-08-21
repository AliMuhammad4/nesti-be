import OpenAI from 'openai';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

const MODEL = 'gpt-4o-mini';
let client;

function openai() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const TEMPLATE_BLOCKS = {
  agent: ['hero', 'expertise', 'role-details', 'about', 'properties', 'testimonials', 'services', 'guidance', 'cta'],
  mortgage_broker: ['hero', 'expertise', 'role-details', 'about', 'mortgage-calculator', 'testimonials', 'services', 'mortgage-programs', 'guidance', 'cta'],
  lawyer: ['hero', 'expertise', 'role-details', 'about', 'closing-cost-estimator', 'testimonials', 'practice-areas', 'services', 'credentials', 'guidance', 'cta'],
};

const TEMPLATE_SPECIFIC_BLOCKS = Object.freeze({
  'lawyer-classic': [
    'hero',
    'about',
    'who-we-help',
    'expertise',
    'practice-areas',
    'document-checklist',
    'fee-guidance',
    'role-details',
    'consultation-options',
    'testimonials',
    'credentials',
    'guidance',
    'faq',
    'cta',
    'footer',
  ],
  'agent-community-expert': [
    'hero',
    'featured-listings',
    'role-details',
    'about',
    'services',
    'expertise',
    'seller-performance',
    'seller-sold-results',
    'seller-case-study',
    'seller-credentials',
    'testimonials',
    'guidance',
    'cta',
    'footer',
  ],
  'agent-investor': [
    'hero',
    'featured-listings',
    'services',
    'guidance',
    'about',
    'cta',
    'footer',
  ],
});

function roleLabel(role) {
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return 'mortgage broker';
  if (role === PROFESSIONAL_TYPE.LAWYER) return 'real estate lawyer';
  return 'real estate agent';
}

function roleForBlocks(role) {
  return Object.hasOwn(TEMPLATE_BLOCKS, role) ? role : 'agent';
}

function defaultTemplateKeyForRole(role) {
  const resolved = roleForBlocks(role);
  if (resolved === 'agent') return 'agent-investor';
  return `${resolved}-classic`;
}

function cleanText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function parseObject(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI response did not contain valid JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function normaliseGeneratedCopy(payload) {
  const services = Array.isArray(payload?.services)
    ? payload.services.slice(0, 6).map((service) => ({
      title: cleanText(service?.title, 80),
      description: cleanText(service?.description, 280),
      cta_text: cleanText(service?.cta_text, 40) || 'Learn More',
    })).filter((service) => service.title)
    : [];

  return {
    headline: cleanText(payload?.headline, 100),
    tagline: cleanText(payload?.tagline, 200),
    about: cleanText(payload?.about, 2000),
    seo_meta: {
      title: cleanText(payload?.seo_meta?.title, 60),
      description: cleanText(payload?.seo_meta?.description, 160),
      keywords: Array.isArray(payload?.seo_meta?.keywords)
        ? payload.seo_meta.keywords.map((keyword) => cleanText(keyword, 50)).filter(Boolean).slice(0, 8)
        : [],
    },
    services,
  };
}

function generatedContentForBlock(type, generated = {}, templateKey = '') {
  if (type === 'hero') {
    if (templateKey === 'lawyer-classic') {
      return {
        heading: generated.headline || '',
        body: generated.tagline || '',
        eyebrow: 'Property law · Closing counsel',
        primary_cta_label: 'Submit inquiry',
        cta_label: 'Make an appointment',
        lawyer_classic_design_version: 2,
      };
    }
    return { heading: generated.headline || '', body: generated.tagline || '' };
  }
  if (type === 'about') {
    if (templateKey === 'lawyer-classic') {
      return {
        eyebrow: 'About the practice',
        heading: 'Real estate legal counsel',
        body: generated.about || '',
      };
    }
    return { heading: 'About', body: generated.about || '' };
  }
  if (type === 'expertise' && templateKey === 'lawyer-classic') {
    return {
      eyebrow: 'Practice snapshot',
      heading: 'Where counsel is focused',
      body: 'A concise view of specializations, markets, and how a legal inquiry typically proceeds.',
    };
  }
  if (type === 'who-we-help' && templateKey === 'lawyer-classic') {
    return {
      eyebrow: 'Who we help',
      heading: 'Counsel for every side of the transaction',
      body: 'Buyers, sellers, refinancers, and property owners can start with a structured inquiry.',
    };
  }
  if (type === 'document-checklist' && templateKey === 'lawyer-classic') {
    return {
      eyebrow: 'File preparation',
      heading: 'What to send before we speak',
      body: 'A complete file helps the lawyer understand the matter without asking you to repeat the basics.',
    };
  }
  if (type === 'fee-guidance' && templateKey === 'lawyer-classic') {
    return {
      eyebrow: 'Fee transparency',
      heading: 'How legal fees are typically framed',
      body: 'Use this as orientation before a consultation. It is not a quote, retainer, or promise of representation.',
    };
  }
  if (type === 'consultation-options' && templateKey === 'lawyer-classic') {
    return {
      eyebrow: 'Start the conversation',
      heading: 'Choose how you would like to begin',
      body: 'Pick the path that matches your timeline. Confidential details should wait until the lawyer confirms representation.',
    };
  }
  if (type === 'faq' && templateKey === 'lawyer-classic') {
    return {
      eyebrow: 'Helpful questions',
      heading: 'What clients often ask',
      body: 'Clear answers to common questions before you start.',
      faqs: [
        { q: 'Is this legal advice?', a: 'No. This page starts an inquiry so the lawyer can review the matter and follow up appropriately.' },
        { q: 'Can I request a contract review?', a: 'Yes. Share the agreement, conditions, and timeline so the review request arrives with useful context.' },
        { q: 'What should I send before we speak?', a: 'The property address, agreement of purchase and sale, closing date, and any title or financing documents you already have.' },
        { q: 'When should I contact a lawyer?', a: 'As soon as an offer is being drafted or a closing date is in view — earlier contact leaves more time to resolve conditions and title issues.' },
        { q: 'What happens after I submit an inquiry?', a: 'The lawyer reviews the information, checks whether the matter is a fit, and contacts you about availability and next steps.' },
        { q: 'Can legal fees be confirmed before work begins?', a: 'Yes. Once the scope is clear, the lawyer can explain the expected legal fees, disbursements, and retainer requirements.' },
      ],
    };
  }
  if (type === 'services') {
    return {
      heading: 'How I can help',
      items: Array.isArray(generated.services) ? generated.services : [],
    };
  }
  return {};
}

function defaultBlocks(role, templateKey = '', generated = {}) {
  const types = TEMPLATE_SPECIFIC_BLOCKS[templateKey] || TEMPLATE_BLOCKS[roleForBlocks(role)];
  return types.map((type, index) => ({
    id: `${type}-${index + 1}`,
    type,
    version: 1,
    enabled: true,
    settings: {},
    content: generatedContentForBlock(type, generated, templateKey),
  }));
}

export async function generateStorefrontDraft({ user, professionalProfile, onboarding = {}, templateKey, brandKit = {} }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OpenAI is not configured');
    error.statusCode = 503;
    throw error;
  }

  const role = roleForBlocks(professionalProfile?.professional_type || user?.role);
  const resolvedTemplateKey = cleanText(templateKey, 80) || defaultTemplateKeyForRole(role);
  const context = {
    professional_type: role,
    full_name: professionalProfile?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' '),
    company_name: professionalProfile?.company_name || '',
    location: professionalProfile?.location || '',
    experience: professionalProfile?.experience || '',
    specializations: professionalProfile?.specializations || [],
    languages_spoken: professionalProfile?.languages_spoken || [],
    cities: professionalProfile?.service_area_cities || [],
    onboarding,
    brand_kit: brandKit,
    template_key: resolvedTemplateKey,
  };
  const templateInstructions = resolvedTemplateKey === 'lawyer-classic'
    ? 'For the lawyer-classic template, write the headline, tagline, and about copy specifically for a real estate legal practice. Emphasize clear transaction, contract, title, and closing guidance without implying a lawyer-client relationship, promising outcomes, or giving legal advice.'
    : '';

  const completion = await openai().chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: 'Return strict JSON only. Write factual, conversion-focused storefront content. Never invent awards, credentials, transaction results, mortgage rates, property values, client testimonials, legal advice, or guarantees.',
      },
      {
        role: 'user',
        content: `Create a personalized website draft for this ${roleLabel(role)}. ${templateInstructions} Return exactly: headline, tagline, about, seo_meta {title, description, keywords}, services [{title,description,cta_text}].\n\nContext:\n${JSON.stringify(context)}`,
      },
    ],
  });

  const generated = normaliseGeneratedCopy(parseObject(completion.choices[0]?.message?.content));
  if (!generated.headline || !generated.tagline || !generated.about) {
    const error = new Error('AI returned incomplete storefront content');
    error.statusCode = 502;
    throw error;
  }

  return {
    ...generated,
    template_key: resolvedTemplateKey,
    storefront_blocks: defaultBlocks(role, resolvedTemplateKey, generated),
    brand_kit: {
      ...brandKit,
      business_name: cleanText(brandKit.business_name || professionalProfile?.company_name, 120),
      logo_url: cleanText(brandKit.logo_url, 1000),
      logo_dark_url: cleanText(brandKit.logo_dark_url, 1000),
      primary_color: cleanText(brandKit.primary_color, 16),
      accent_color: cleanText(brandKit.accent_color, 16),
      font: cleanText(brandKit.font || brandKit.font_family, 80),
      button_shape: cleanText(brandKit.button_shape, 30),
      image_style: cleanText(brandKit.image_style, 80),
      essentials: {
        ...(brandKit.essentials || {}),
        ...onboarding,
      },
    },
    generation_metadata: {
      model: MODEL,
      generated_at: new Date().toISOString(),
      template_key: resolvedTemplateKey,
      ...(resolvedTemplateKey === 'lawyer-classic' ? { lawyer_classic_design_version: 2 } : {}),
    },
  };
}

export function generateDefaultStorefrontBlocks(role, templateKey = '', generated = {}) {
  return defaultBlocks(role, templateKey, generated);
}
