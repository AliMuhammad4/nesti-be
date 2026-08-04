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
