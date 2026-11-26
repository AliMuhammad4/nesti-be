import { randomUUID } from 'node:crypto';
import {
  canonicalizeLawyerInvestorDraft,
  LAWYER_INVESTOR_TEMPLATE_ID,
} from './lawyerInvestorStorefrontContract.js';
import {
  canonicalizeLawyerNewcomerDraft,
  LAWYER_NEWCOMER_DESIGN_VERSION,
  LAWYER_NEWCOMER_TEMPLATE_ID,
} from './lawyerNewcomerStorefrontContract.js';

function toPlainObject(value) {
  if (!value) return null;
  const object = typeof value.toObject === 'function' ? value.toObject() : value;
  return JSON.parse(JSON.stringify(object));
}

const PUBLIC_ESSENTIAL_KEYS = Object.freeze([
  'calendly_link',
  'email',
  'languages_spoken',
  'lawyer_classic_brand_version',
  'lawyer_first_home_brand_version',
  'lawyer_newcomer_brand_version',
  'logo_chip_mode',
  'profile_photo_url',
  'service_area',
  'years_experience',
  'investor_theme_preset',
  'investor_color_mode',
  'investor_gradients',
  'investor_animations',
  'aurora_theme_preset',
  'aurora_color_mode',
  'aurora_gradients',
  'aurora_animations',
]);

const PUBLIC_INVESTOR_THEME_PRESETS = new Set([
  'emerald-mint',
  'ocean-blue',
  'royal-indigo',
  'sunset-coral',
  'graphite-gold',
  'midnight-gold',
  'clean-light',
]);

const PUBLIC_AURORA_THEME_PRESETS = new Set([
  'royal-indigo',
  'emerald-mint',
  'midnight-gold',
  'clean-light',
  'custom',
]);

const PUBLIC_INVESTOR_VISUAL_OPTIONS = Object.freeze({
  shadow: ['none', 'soft', 'medium', 'large'],
  spacing: ['compact', 'comfortable', 'airy'],
  content_width: ['narrow', 'standard', 'wide'],
  card_radius: ['subtle', 'rounded', 'soft'],
});

const PUBLIC_AURORA_VISUAL_OPTIONS = Object.freeze({
  shadow: ['none', 'soft', 'medium', 'large'],
  spacing: ['compact', 'comfortable', 'spacious'],
  content_width: ['narrow', 'standard', 'wide'],
  card_radius: ['subtle', 'rounded', 'soft'],
  card_style: ['flat', 'elevated', 'glass'],
  divider_style: ['none', 'soft', 'angled'],
  button_style: ['solid', 'gradient', 'outline', 'soft', 'ghost'],
  button_size: ['small', 'medium', 'large'],
});

function publicInvestorVisuals(value) {
  const source = toPlainObject(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const visuals = {};
  const gradientAngle = Number(source.gradient_angle);
  if (source.gradient_angle !== null && source.gradient_angle !== ''
    && Number.isFinite(gradientAngle) && gradientAngle >= 0 && gradientAngle <= 360) {
    visuals.gradient_angle = gradientAngle;
  }
  const gradientIntensity = Number(source.gradient_intensity);
  if (source.gradient_intensity !== null && source.gradient_intensity !== ''
    && Number.isFinite(gradientIntensity) && gradientIntensity >= 0 && gradientIntensity <= 60) {
    visuals.gradient_intensity = gradientIntensity;
  }
  for (const [key, options] of Object.entries(PUBLIC_INVESTOR_VISUAL_OPTIONS)) {
    if (options.includes(source[key])) visuals[key] = source[key];
  }

  return Object.keys(visuals).length ? visuals : null;
}

function publicAuroraVisuals(value) {
  const source = toPlainObject(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const visuals = {};
  const gradientAngle = Number(source.gradient_angle);
  if (source.gradient_angle !== null && source.gradient_angle !== ''
    && Number.isFinite(gradientAngle) && gradientAngle >= 0 && gradientAngle <= 360) {
    visuals.gradient_angle = gradientAngle;
  }
  const gradientIntensity = Number(source.gradient_intensity);
  if (source.gradient_intensity !== null && source.gradient_intensity !== ''
    && Number.isFinite(gradientIntensity) && gradientIntensity >= 0 && gradientIntensity <= 60) {
    visuals.gradient_intensity = gradientIntensity;
  }
  for (const [key, options] of Object.entries(PUBLIC_AURORA_VISUAL_OPTIONS)) {
    if (options.includes(source[key])) visuals[key] = source[key];
  }

  return Object.keys(visuals).length ? visuals : null;
}

function publicEssentials(essentials) {
  const source = toPlainObject(essentials) || {};
  const result = Object.fromEntries(
    PUBLIC_ESSENTIAL_KEYS
      .filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, source[key]]),
  );
  if (!PUBLIC_INVESTOR_THEME_PRESETS.has(result.investor_theme_preset)) {
    delete result.investor_theme_preset;
  }
  if (!PUBLIC_AURORA_THEME_PRESETS.has(result.aurora_theme_preset)) {
    delete result.aurora_theme_preset;
  }
  if (!['light', 'dark', 'auto'].includes(result.investor_color_mode)) {
    delete result.investor_color_mode;
  }
  for (const key of [
    'investor_gradients',
    'investor_animations',
    'aurora_gradients',
    'aurora_animations',
  ]) {
    if (typeof result[key] !== 'boolean') delete result[key];
  }
  if (!['light', 'dark', 'auto'].includes(result.aurora_color_mode)) {
    delete result.aurora_color_mode;
  }
  const investorVisuals = publicInvestorVisuals(source.investor_visuals);
  if (investorVisuals) result.investor_visuals = investorVisuals;
  const auroraVisuals = publicAuroraVisuals(source.aurora_visuals);
  if (auroraVisuals) result.aurora_visuals = auroraVisuals;
  return result;
}

export function serializeStorefrontRevision(revision, { publicView = false } = {}) {
  const source = toPlainObject(revision);
  if (!source) return null;
  const brandKit = source.brandKit || {};

  return {
    blocks: Array.isArray(source.blocks) ? source.blocks : [],
    brandKit: publicView
      ? { ...brandKit, essentials: publicEssentials(brandKit.essentials) }
      : brandKit,
    template: source.template || {},
    seo_meta: source.seo_meta || {},
    revision_id: source.revision_id || null,
    revision_version: Number.isSafeInteger(source.revision_version)
      ? source.revision_version
      : 0,
    updated_at: source.updated_at || null,
    published_at: source.published_at || null,
    ...(source.website ? { website: source.website } : {}),
  };
}

export function createDraftRevision(draft, now = new Date(), { previousRevision = null } = {}) {
  const previousVersion = Number(previousRevision?.revision_version);
  return {
    blocks: Array.isArray(draft?.blocks) ? draft.blocks : [],
    brandKit: draft?.brandKit || {},
    template: draft?.template || {},
    seo_meta: draft?.seo_meta || {},
    revision_id: randomUUID(),
    revision_version: Number.isSafeInteger(previousVersion) && previousVersion >= 0
      ? previousVersion + 1
      : 1,
    updated_at: now,
    published_at: null,
    ...(draft?.website ? { website: draft.website } : {}),
  };
}

const STOREFRONT_BRAND_KIT_KEYS = Object.freeze([
  'logo_url',
  'logo_dark_url',
  'cover_url',
  'profile_photo_url',
  'logo_size',
  'cover_position_x',
  'cover_position_y',
  'cover_zoom',
  'profile_position_x',
  'profile_position_y',
  'profile_zoom',
  'primary_color',
  'secondary_color',
  'accent_color',
  'page_background',
  'font_family',
  'business_name',
  'button_shape',
  'image_style',
  'essentials',
  'show_chatbot',
]);

function generatedRevisionBlocks(generated = {}) {
  return (generated?.storefront_blocks || []).map((block) => ({
    id: block.id,
    type: block.type,
    data: {
      enabled: block.enabled !== false,
      content: block.content || {},
      ...(block.settings && Object.keys(block.settings).length ? { layout: block.settings } : {}),
      ...(block.style && Object.keys(block.style).length ? { style: block.style } : {}),
    },
  }));
}

function mergeGeneratedBlocks(generatedBlocks, existingBlocks = []) {
  if (!Array.isArray(existingBlocks) || !existingBlocks.length) return generatedBlocks;

  const normalizedExisting = existingBlocks.map(
    (block) => block?.toObject?.() || block,
  );
  const unusedGenerated = new Set(generatedBlocks.map((_, index) => index));
  const mergedExisting = normalizedExisting.map((existingBlock) => {
    let generatedIndex = generatedBlocks.findIndex(
      (block, index) => unusedGenerated.has(index) && block.id === existingBlock?.id,
    );
    if (generatedIndex < 0) {
      generatedIndex = generatedBlocks.findIndex(
        (block, index) => unusedGenerated.has(index) && block.type === existingBlock?.type,
      );
    }
    if (generatedIndex < 0) return existingBlock;

    unusedGenerated.delete(generatedIndex);
    const generatedBlock = generatedBlocks[generatedIndex];
    return {
      ...generatedBlock,
      ...existingBlock,
      id: existingBlock.id,
      type: existingBlock.type,
      data: {
        ...generatedBlock.data,
        ...(existingBlock.data || {}),
        content: {
          ...(existingBlock.data?.content || {}),
          ...(generatedBlock.data?.content || {}),
        },
      },
    };
  });

  // Existing drafts own their structure. AI refreshes copy for matching blocks
  // without resurrecting sections the user intentionally removed or moved.
  return mergedExisting;
}

export function createGeneratedDraftRevision(
  generated,
  existingBrandKit = {},
  now = new Date(),
  existingBlocks = [],
  previousRevision = null,
) {
  const generatedBrandKit = generated?.brand_kit || {};
  const mergedBrandKit = { ...existingBrandKit };
  STOREFRONT_BRAND_KIT_KEYS.forEach((key) => {
    if (generatedBrandKit[key] !== undefined) mergedBrandKit[key] = generatedBrandKit[key];
  });
  if (generatedBrandKit.font !== undefined) {
    mergedBrandKit.font_family = generatedBrandKit.font;
  }

  let normalizedExistingBlocks = existingBlocks;
  if (generated?.template_key === LAWYER_INVESTOR_TEMPLATE_ID) {
    normalizedExistingBlocks = canonicalizeLawyerInvestorDraft({
      blocks: existingBlocks,
      template: { id: LAWYER_INVESTOR_TEMPLATE_ID },
    }, generated).blocks;
  } else if (generated?.template_key === LAWYER_NEWCOMER_TEMPLATE_ID) {
    normalizedExistingBlocks = canonicalizeLawyerNewcomerDraft({
      blocks: existingBlocks,
      template: {
        id: LAWYER_NEWCOMER_TEMPLATE_ID,
        version: previousRevision?.template?.version,
      },
    }, generated).blocks;
  }
  const draft = {
    blocks: mergeGeneratedBlocks(generatedRevisionBlocks(generated), normalizedExistingBlocks),
    brandKit: mergedBrandKit,
    seo_meta: generated?.seo_meta || {},
    template: {
      id: generated?.template_key || '',
      name: generated?.template_key || '',
      version: generated?.template_key === LAWYER_NEWCOMER_TEMPLATE_ID
        ? String(LAWYER_NEWCOMER_DESIGN_VERSION)
        : '1',
    },
  };
  return createDraftRevision(
    canonicalizeStorefrontDraft(draft, generated),
    now,
    { previousRevision },
  );
}

export function canonicalizeStorefrontDraft(draft, generated = {}) {
  return canonicalizeLawyerNewcomerDraft(
    canonicalizeLawyerInvestorDraft(draft, generated),
    generated,
  );
}

export function templateIdForRevision(revision) {
  return String(revision?.template?.id || '').trim();
}

export function storefrontDrafts(storefront = {}) {
  const persisted = Array.isArray(storefront?.drafts) ? storefront.drafts : [];
  const legacy = storefront?.draft ? [storefront.draft] : [];
  const byTemplate = new Map();
  [...legacy, ...persisted].forEach((revision) => {
    const templateId = templateIdForRevision(revision);
    if (!templateId) return;
    byTemplate.set(templateId, revision);
  });
  return [...byTemplate.values()];
}

export function activeStorefrontDraft(storefront = {}) {
  const activeTemplateId = String(storefront?.active_template_id || '').trim();
  if (activeTemplateId) {
    const activeRevision = storefrontDrafts(storefront).find(
      (revision) => templateIdForRevision(revision) === activeTemplateId,
    );
    if (activeRevision) return activeRevision;
  }
  const drafts = storefrontDrafts(storefront);
  if (storefront?.draft) {
    const legacyTemplateId = templateIdForRevision(storefront.draft);
    return drafts.find((revision) => templateIdForRevision(revision) === legacyTemplateId)
      || storefront.draft;
  }
  return drafts[0] || null;
}

export function serializeStorefrontDrafts(storefront = {}) {
  return storefrontDrafts(storefront)
    .map(serializeStorefrontRevision)
    .filter(Boolean);
}

export function createPublishedRevision(draft, now = new Date()) {
  const revision = serializeStorefrontRevision(draft);
  if (!revision) return null;

  return {
    blocks: revision.blocks,
    brandKit: revision.brandKit,
    template: revision.template,
    seo_meta: revision.seo_meta,
    revision_id: revision.revision_id,
    revision_version: revision.revision_version,
    updated_at: revision.updated_at || now,
    published_at: now,
    ...(revision.website ? { website: revision.website } : {}),
  };
}

export function serializePublishedStorefront(storefront) {
  return serializeStorefrontRevision(storefront?.published, { publicView: true });
}
