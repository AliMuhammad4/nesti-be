import OpenAI from 'openai';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

const MODEL = 'gpt-4o-mini';
let client;

function openai() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const TEMPLATE_BLOCKS = {
  agent: ['hero', 'expertise', 'role-details', 'about', 'properties', 'home-valuation', 'testimonials', 'services', 'guidance', 'cta'],
  mortgage_broker: ['hero', 'expertise', 'role-details', 'about', 'mortgage-calculator', 'testimonials', 'services', 'mortgage-programs', 'guidance', 'cta'],
  lawyer: ['hero', 'expertise', 'role-details', 'about', 'closing-cost-estimator', 'testimonials', 'practice-areas', 'services', 'credentials', 'guidance', 'cta'],
};

function roleLabel(role) {
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return 'mortgage broker';
  if (role === PROFESSIONAL_TYPE.LAWYER) return 'real estate lawyer';
  return 'real estate agent';
}

function roleForBlocks(role) {
  return Object.hasOwn(TEMPLATE_BLOCKS, role) ? role : 'agent';
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

function defaultBlocks(role) {
  return TEMPLATE_BLOCKS[roleForBlocks(role)].map((type, index) => ({
    id: `${type}-${index + 1}`,
    type,
    version: 1,
    enabled: true,
    settings: {},
    content: {},
  }));
}

export async function generateStorefrontDraft({ user, professionalProfile, onboarding = {}, templateKey, brandKit = {} }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OpenAI is not configured');
    error.statusCode = 503;
    throw error;
  }

  const role = roleForBlocks(professionalProfile?.professional_type || user?.role);
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
    template_key: cleanText(templateKey, 80),
  };

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
        content: `Create a personalized website draft for this ${roleLabel(role)}. Return exactly: headline, tagline, about, seo_meta {title, description, keywords}, services [{title,description,cta_text}].\n\nContext:\n${JSON.stringify(context)}`,
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
    template_key: cleanText(templateKey, 80) || `${role}-classic`,
    storefront_blocks: defaultBlocks(role),
    brand_kit: {
      business_name: cleanText(brandKit.business_name || professionalProfile?.company_name, 120),
      logo_url: cleanText(brandKit.logo_url, 1000),
      logo_dark_url: cleanText(brandKit.logo_dark_url, 1000),
      primary_color: cleanText(brandKit.primary_color, 16),
      accent_color: cleanText(brandKit.accent_color, 16),
      font: cleanText(brandKit.font, 80),
      button_shape: cleanText(brandKit.button_shape, 30),
      image_style: cleanText(brandKit.image_style, 80),
      essentials: onboarding,
    },
    generation_metadata: {
      model: MODEL,
      generated_at: new Date().toISOString(),
      template_key: cleanText(templateKey, 80) || `${role}-classic`,
    },
  };
}

export function generateDefaultStorefrontBlocks(role) {
  return defaultBlocks(role);
}
