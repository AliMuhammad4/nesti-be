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
]);

function publicEssentials(essentials) {
  const source = toPlainObject(essentials) || {};
  return Object.fromEntries(
    PUBLIC_ESSENTIAL_KEYS
      .filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, source[key]]),
  );
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
  };
}

export function serializePublishedStorefront(storefront) {
  return serializeStorefrontRevision(storefront?.published, { publicView: true });
}
