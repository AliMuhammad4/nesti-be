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
