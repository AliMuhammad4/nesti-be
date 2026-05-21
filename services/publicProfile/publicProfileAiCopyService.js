import OpenAI from 'openai';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const MODEL = 'gpt-4o-mini';

function roleLabel(role) {
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return 'mortgage broker';
  if (role === PROFESSIONAL_TYPE.LAWYER) return 'real estate lawyer';
  return 'real estate agent';
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean) : [];
}

function buildProfileContext({ user, professionalProfile }) {
  const profile = professionalProfile || {};
  const fullName =
    String(profile.full_name || '').trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim();

  return {
    professional_type: profile.professional_type || user.role || PROFESSIONAL_TYPE.AGENT,
    full_name: fullName,
    company_name: profile.company_name || '',
    location: profile.location || '',
    target_neighborhoods: profile.target_neighborhoods || '',
    experience: profile.experience || '',
    license_number: profile.license_number || '',
    website: profile.website || '',
    transaction_volume: profile.transaction_volume || '',
    avg_sale_price: profile.avg_sale_price || '',
    response_time: profile.response_time || '',
    availability: profile.availability || '',
    support_level: profile.support_level || '',
    negotiation_style: profile.negotiation_style || '',
    sales_approach: profile.sales_approach || '',
    energy_style: profile.energy_style || '',
    personality_tag: profile.personality_tag || '',
    awards: profile.awards || '',
    bio: profile.bio || '',
    certificates: compactArray(profile.certificates),
    specializations: compactArray(profile.specializations),
    communication_channels: compactArray(profile.communication_channels),
    preferred_clients: compactArray(profile.preferred_clients),
  };
}

function parseJson(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not include valid JSON');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function cleanCopy(payload) {
  return {
    headline: String(payload?.headline || '').trim().slice(0, 100),
    tagline: String(payload?.tagline || '').trim().slice(0, 200),
    about: String(payload?.about || '').trim().slice(0, 2000),
  };
}

export async function generatePublicProfileCopy({ user, professionalProfile }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OpenAI is not configured');
    error.statusCode = 503;
    throw error;
  }

  const context = buildProfileContext({ user, professionalProfile });
  const role = context.professional_type;

  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.28,
    max_tokens: 900,
    messages: [
      {
        role: 'system',
        content:
          'You write premium, conversion-focused professional storefront copy for a real estate platform. Return strict JSON only with keys: headline, tagline, about. Do not invent specific unverifiable numbers, awards, credentials, or guarantees. Use only provided facts, but make the copy polished and role-specific.',
      },
      {
        role: 'user',
        content: `Create public landing page copy for this ${roleLabel(role)}.

Style requirements:
- Agent: luxury modern real estate brand, warm, premium, buyer/seller focused.
- Mortgage broker: financial, trustworthy, clear, pre-approval and confidence focused.
- Lawyer: clean, premium, professional, secure transaction focused.

Field requirements:
- headline: max 100 characters, strong hero headline.
- tagline: max 200 characters, one concise supporting sentence.
- about: 2 short paragraphs, max 2000 characters, client-benefit focused.

Professional profile context:
${JSON.stringify(context, null, 2)}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '';
  const copy = cleanCopy(parseJson(raw));

  if (!copy.headline || !copy.tagline || !copy.about) {
    const error = new Error('AI response was incomplete');
    error.statusCode = 502;
    throw error;
  }

  return copy;
}
