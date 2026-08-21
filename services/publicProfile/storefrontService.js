function toPlainObject(value) {
  if (!value) return null;
  const object = typeof value.toObject === 'function' ? value.toObject() : value;
  return JSON.parse(JSON.stringify(object));
}

export function serializeStorefrontRevision(revision) {
  const source = toPlainObject(revision);
  if (!source) return null;

  return {
    blocks: Array.isArray(source.blocks) ? source.blocks : [],
    brandKit: source.brandKit || {},
    template: source.template || {},
    updated_at: source.updated_at || null,
    published_at: source.published_at || null,
  };
}

export function createDraftRevision(draft, now = new Date()) {
  return {
    blocks: Array.isArray(draft?.blocks) ? draft.blocks : [],
    brandKit: draft?.brandKit || {},
    template: draft?.template || {},
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
) {
  const generatedBrandKit = generated?.brand_kit || {};
  const mergedBrandKit = { ...existingBrandKit };
  STOREFRONT_BRAND_KIT_KEYS.forEach((key) => {
    if (generatedBrandKit[key] !== undefined) mergedBrandKit[key] = generatedBrandKit[key];
  });
  if (generatedBrandKit.font !== undefined) {
    mergedBrandKit.font_family = generatedBrandKit.font;
  }

  return createDraftRevision({
    blocks: mergeGeneratedBlocks(generatedRevisionBlocks(generated), existingBlocks),
    brandKit: mergedBrandKit,
    template: {
      id: generated?.template_key || '',
      name: generated?.template_key || '',
      version: '1',
    },
  }, now);
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
  return storefront?.draft || null;
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
    updated_at: revision.updated_at || now,
    published_at: now,
  };
}

export function serializePublishedStorefront(storefront) {
  return serializeStorefrontRevision(storefront?.published);
}
