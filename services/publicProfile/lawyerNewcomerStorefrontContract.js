export const LAWYER_NEWCOMER_TEMPLATE_ID = 'lawyer-newcomer';
export const LAWYER_NEWCOMER_DESIGN_VERSION = 6;

export const LAWYER_NEWCOMER_BLOCK_TYPES = Object.freeze([
  'hero',
  'about',
  'practice-areas',
  'services',
  'guidance',
  'credentials',
  'testimonials',
  'cta',
  'footer',
]);

const LEGACY_DEFAULT_BLOCK_IDS = Object.freeze({
  hero: 'hero-1',
  guidance: 'guidance-2',
  'practice-areas': 'practice-areas-3',
  testimonials: 'testimonials-4',
  cta: 'cta-5',
});

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const DEFAULT_SERVICES = Object.freeze([
  {
    id: 'newcomer-service-agreement',
    title: 'Purchase agreement review',
    description: 'Review the agreement, conditions, dates, and closing obligations in the context of the proposed transaction.',
    icon: 'contract',
    link_disabled: true,
  },
  {
    id: 'newcomer-service-title',
    title: 'Title and closing preparation',
    description: 'Coordinate title searches, lender instructions, insurance details, signing, funds, registration, and reporting.',
    icon: 'shield',
    link_disabled: true,
  },
  {
    id: 'newcomer-service-costs',
    title: 'Closing cost orientation',
    description: 'Explain the categories of legal fees, disbursements, adjustments, and taxes that may apply to the file.',
    icon: 'dollar',
    link_disabled: true,
  },
  {
    id: 'newcomer-service-documents',
    title: 'Document and identity guidance',
    description: 'Identify the documents and identity information commonly requested before signing and closing.',
    icon: 'file',
    link_disabled: true,
  },
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function generatedServices(generated = {}) {
  if (!Array.isArray(generated.services) || !generated.services.length) {
    return clone(DEFAULT_SERVICES);
  }
  return generated.services.slice(0, 6).map((service, index) => ({
    id: `newcomer-service-generated-${index + 1}`,
    title: service?.title || '',
    description: service?.description || '',
    cta_text: service?.cta_text || 'Learn more',
    link_disabled: true,
  }));
}

export function createLawyerNewcomerGeneratedBlocks(generated = {}) {
  const definitions = [
    {
      type: 'hero',
      content: {
        newcomer_design_version: LAWYER_NEWCOMER_DESIGN_VERSION,
        eyebrow: 'Newcomer home-closing guidance',
        heading: generated.headline || 'Clear closing support for your new home',
        body: generated.tagline || 'Plain-language real estate legal support for buyers learning a new closing process.',
        primary_cta_label: 'Start a closing inquiry',
        cta_label: 'Book an introductory call',
      },
      settings: {
        alignment: 'center',
        padding: 'medium',
        width: 'contained',
        columns: '2',
        mediaPosition: 'background',
        animationType: 'fade',
        animationDuration: 'slow',
        animationIntensity: 'subtle',
      },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'about',
      content: {
        eyebrow: 'A clear place to begin',
        heading: 'Understand the legal closing process',
        body: generated.about || 'A prepared legal file helps you understand the documents, timing, funds, and responsibilities involved in a Canadian residential purchase.',
      },
      settings: { padding: 'medium', width: 'contained', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'practice-areas',
      content: {
        eyebrow: 'Residential purchase support',
        heading: 'Help for each part of the closing',
        body: 'Legal services are scoped to the facts of your transaction and begin only after the lawyer confirms the engagement.',
        items: [
          { id: 'newcomer-practice-purchase', title: 'Home purchases', description: 'Agreement, title, lender, signing, funds, registration, and closing support.', icon: 'home' },
          { id: 'newcomer-practice-condo', title: 'Condominium purchases', description: 'Purchase closing support, including transaction-specific condominium documents and requirements.', icon: 'building' },
          { id: 'newcomer-practice-financing', title: 'Mortgage instructions', description: 'Coordinate lender documents, signing conditions, funding, and registration requirements.', icon: 'landmark' },
          { id: 'newcomer-practice-title', title: 'Title questions', description: 'Review title information and explain issues that require attention before completion.', icon: 'shield' },
        ],
      },
      settings: { columns: '2', padding: 'medium', width: 'contained', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'services',
      content: {
        eyebrow: 'Newcomer-friendly legal services',
        heading: 'Prepare for closing with clear next steps',
        body: 'Share the property, agreement, financing, and target closing date so the lawyer can assess the requested work.',
        items: generatedServices(generated),
      },
      settings: { columns: '2', padding: 'medium', width: 'contained', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'guidance',
      content: {
        eyebrow: 'Your closing roadmap',
        heading: 'Know what usually happens next',
        body: 'Every file is different, but organized information helps the lawyer identify the steps and requirements that apply.',
        steps: [
          { id: 'newcomer-step-share', title: 'Share the transaction', text: 'Provide the signed agreement, property address, closing date, financing status, and contact details.', icon: 'notebook' },
          { id: 'newcomer-step-confirm', title: 'Confirm scope and timing', text: 'The lawyer reviews the inquiry, checks availability, and explains the engagement and requested documents.', icon: 'contract' },
          { id: 'newcomer-step-prepare', title: 'Prepare signing and funds', text: 'Complete identity, lender, insurance, document, and funds requirements communicated for the file.', icon: 'file' },
          { id: 'newcomer-step-close', title: 'Complete and report', text: 'The legal team coordinates completion, registration, funds, key release, and final reporting as applicable.', icon: 'home' },
        ],
      },
      settings: { columns: '2', padding: 'medium', width: 'contained', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'credentials',
      content: {
        eyebrow: 'Professional information',
        heading: 'Meet your real estate lawyer',
        body: 'Review the lawyer’s published professional details, service area, languages, and practice focus.',
      },
      settings: { columns: '4', padding: 'medium', width: 'contained', animationType: 'fade', animationIntensity: 'subtle' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'testimonials',
      content: {
        eyebrow: 'Client feedback',
        heading: 'Verified experiences from past clients',
        body: 'Published feedback reflects individual experiences and does not promise a similar result.',
      },
      settings: { columns: '2', padding: 'medium', width: 'contained', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'cta',
      content: {
        eyebrow: 'Ready to ask about your closing?',
        heading: 'Start with the transaction details',
        body: 'Send the property, agreement, financing status, closing date, and preferred language for an initial response.',
        cta_label: 'Book an introductory call',
        secondary_cta_label: 'Start a closing inquiry',
        helper_text: 'An inquiry does not create a lawyer-client relationship.',
      },
      settings: { padding: 'medium', width: 'contained', animationType: 'fade', animationIntensity: 'subtle' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'medium' },
    },
    {
      type: 'footer',
      content: {
        eyebrow: 'Newcomer home-closing counsel',
        heading: generated.business_name || '',
        body: 'Plain-language support for residential purchase inquiries, closing preparation, and legal next steps.',
        role_label: 'Real estate lawyer',
        contact_heading: 'Start an inquiry',
        disclaimer: 'General information only, not legal advice. Do not send confidential information until the lawyer confirms representation.',
        show_email: true,
        show_phone: true,
        show_booking: true,
        items: [
          { id: 'newcomer-footer-about', label: 'About', target: '#about' },
          { id: 'newcomer-footer-practice', label: 'Practice areas', target: '#practice-areas' },
          { id: 'newcomer-footer-services', label: 'Services', target: '#services' },
          { id: 'newcomer-footer-guidance', label: 'Closing guide', target: '#guidance' },
          { id: 'newcomer-footer-contact', label: 'Start an inquiry', target: '#contact' },
        ],
      },
      settings: { padding: 'medium', width: 'contained' },
      style: { background: '', textColor: '', radius: 'large', shadow: 'none' },
    },
  ];

  return definitions.map((definition, index) => ({
    id: `${definition.type}-${index + 1}`,
    type: definition.type,
    version: 1,
    enabled: true,
    ...clone(definition),
  }));
}

function revisionDefaults(generated = {}) {
  return createLawyerNewcomerGeneratedBlocks(generated).map((block) => ({
    id: block.id,
    type: block.type,
    data: {
      enabled: block.enabled !== false,
      content: clone(block.content || {}),
      layout: clone(block.settings || {}),
      style: clone(block.style || {}),
    },
  }));
}

function collectionKeyForType(type) {
  return {
    'practice-areas': 'items',
    services: 'items',
    guidance: 'steps',
    testimonials: 'items',
    footer: 'items',
  }[type];
}

function normalizeCollectionIds(type, content = {}) {
  const collectionKey = collectionKeyForType(type);
  if (!collectionKey || !Array.isArray(content[collectionKey])) return content;
  const used = new Set();
  return {
    ...content,
    [collectionKey]: content[collectionKey].map((item, index) => {
      const itemObject = item && typeof item === 'object' && !Array.isArray(item)
        ? item
        : {};
      const rawId = String(itemObject.id || '').trim();
      const base = SAFE_ID_PATTERN.test(rawId)
        ? rawId
        : `${type}-${collectionKey}-${index + 1}`;
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }
      used.add(id);
      return { ...itemObject, id };
    }),
  };
}

function normalizeBlockShape(block) {
  const type = block?.type || block?.data?.type;
  return {
    id: block?.id,
    type,
    data: {
      enabled: block?.data?.enabled ?? block?.enabled ?? true,
      content: normalizeCollectionIds(
        type,
        clone(block?.data?.content || block?.content || {}),
      ),
      layout: clone(block?.data?.layout || block?.settings || block?.layout || {}),
      style: clone(block?.data?.style || block?.style || {}),
    },
  };
}

function normalizeBlockIds(blocks) {
  const used = new Set();
  return blocks.map((block, index) => {
    const rawId = String(block?.id || '').trim();
    const base = SAFE_ID_PATTERN.test(rawId) ? rawId : `${block.type}-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return { ...block, id };
  });
}

function mergeLegacyBlock(existing, fallback) {
  const normalized = normalizeBlockShape(existing);
  const fallbackContent = clone(fallback.data?.content || {});
  const existingContent = clone(normalized.data?.content || {});
  const isGenericEmptyAbout = normalized.type === 'about'
    && String(existingContent.heading || '').trim().toLowerCase() === 'about'
    && !String(existingContent.body || '').trim()
    && Number(existingContent.seller_about_layout_version || 0) > 0;
  const mergedContent = {
    ...fallbackContent,
    ...existingContent,
  };
  if (isGenericEmptyAbout) {
    mergedContent.eyebrow = fallbackContent.eyebrow;
    mergedContent.heading = fallbackContent.heading;
    mergedContent.body = fallbackContent.body;
  }
  const mergedStyle = {
    ...clone(fallback.data?.style || {}),
    ...clone(normalized.data?.style || {}),
  };
  if (['#f0fdf4', '#fff7ed', '#0f766e', '#134e4a'].includes(
    String(mergedStyle.background || '').trim().toLowerCase(),
  )) {
    mergedStyle.background = '';
  }
  if (['#134e4a', '#0f766e'].includes(
    String(mergedStyle.textColor || '').trim().toLowerCase(),
  )) {
    mergedStyle.textColor = '';
  }
  const mergedLayout = {
    ...clone(fallback.data?.layout || {}),
    ...clone(normalized.data?.layout || {}),
  };
  if (
    normalized.type === 'credentials'
    && ['', '2', '3'].includes(String(mergedLayout.columns || ''))
  ) {
    mergedLayout.columns = '4';
  }
  return {
    ...clone(fallback),
    ...normalized,
    id: normalized.id || fallback.id,
    type: fallback.type,
    data: {
      ...clone(fallback.data || {}),
      ...clone(normalized.data || {}),
      enabled: normalized.data?.enabled ?? fallback.data?.enabled ?? true,
      content: normalizeCollectionIds(normalized.type, {
        ...mergedContent,
        ...(normalized.type === 'hero'
          ? { newcomer_design_version: LAWYER_NEWCOMER_DESIGN_VERSION }
          : {}),
      }),
      layout: mergedLayout,
      style: mergedStyle,
    },
  };
}

function uniqueDefaultId(defaultId, blocks) {
  const ids = new Set(blocks.map((block) => block?.id).filter(Boolean));
  if (!ids.has(defaultId)) return defaultId;
  let suffix = 2;
  while (ids.has(`${defaultId}-${suffix}`)) suffix += 1;
  return `${defaultId}-${suffix}`;
}

function insertMissingBlock(blocks, fallback) {
  const next = [...blocks];
  const fallbackIndex = LAWYER_NEWCOMER_BLOCK_TYPES.indexOf(fallback.type);
  let insertionIndex = next.findIndex((block) => (
    LAWYER_NEWCOMER_BLOCK_TYPES.indexOf(block?.type) > fallbackIndex
  ));
  if (insertionIndex < 0) insertionIndex = next.length;
  next.splice(insertionIndex, 0, {
    ...clone(fallback),
    id: uniqueDefaultId(fallback.id, next),
  });
  return next;
}

function isLegacyDefaultScaffold(blocks = []) {
  return Object.entries(LEGACY_DEFAULT_BLOCK_IDS).every(([type, id]) => (
    blocks.some((block) => block.type === type && block.id === id)
  ));
}

export function lawyerNewcomerDesignVersion(draft = {}) {
  const templateVersion = Number(draft?.template?.version);
  const blockVersions = (Array.isArray(draft?.blocks) ? draft.blocks : [])
    .filter((block) => (block?.type || block?.data?.type) === 'hero')
    .map((block) => Number(
      block?.data?.content?.newcomer_design_version
      ?? block?.content?.newcomer_design_version,
    ))
    .filter((version) => Number.isFinite(version) && version >= 0);
  return Math.max(
    Number.isFinite(templateVersion) && templateVersion >= 0 ? templateVersion : 0,
    ...blockVersions,
  );
}

export function canonicalizeLawyerNewcomerDraft(draft, generated = {}) {
  if (String(draft?.template?.id || '').trim() !== LAWYER_NEWCOMER_TEMPLATE_ID) {
    return draft;
  }

  const currentVersion = lawyerNewcomerDesignVersion(draft);
  let blocks = (Array.isArray(draft?.blocks) ? draft.blocks : [])
    .filter(Boolean)
    .map((block) => normalizeBlockShape(clone(block)))
    .filter((block) => LAWYER_NEWCOMER_BLOCK_TYPES.includes(block.type));
  const shouldRestoreCanonicalOrder = currentVersion < LAWYER_NEWCOMER_DESIGN_VERSION
    && isLegacyDefaultScaffold(blocks);

  if (currentVersion < LAWYER_NEWCOMER_DESIGN_VERSION) {
    const defaults = revisionDefaults(generated);
    const defaultByType = new Map(defaults.map((block) => [block.type, block]));
    blocks = blocks.map((block) => (
      defaultByType.has(block.type)
        ? mergeLegacyBlock(block, defaultByType.get(block.type))
        : block
    ));
    defaults.forEach((fallback) => {
      if (!blocks.some((block) => block.type === fallback.type)) {
        blocks = insertMissingBlock(blocks, fallback);
      }
    });
    if (shouldRestoreCanonicalOrder) {
      blocks.sort((a, b) => (
        LAWYER_NEWCOMER_BLOCK_TYPES.indexOf(a.type)
        - LAWYER_NEWCOMER_BLOCK_TYPES.indexOf(b.type)
      ));
    }
  }

  blocks = blocks.map((block) => ({
    ...block,
    data: {
      ...block.data,
      content: normalizeCollectionIds(block.type, {
        ...(block.data?.content || {}),
        ...(block.type === 'hero'
          ? { newcomer_design_version: LAWYER_NEWCOMER_DESIGN_VERSION }
          : {}),
      }),
    },
  }));

  return {
    ...draft,
    template: {
      ...(draft.template || {}),
      id: LAWYER_NEWCOMER_TEMPLATE_ID,
      version: String(LAWYER_NEWCOMER_DESIGN_VERSION),
    },
    blocks: normalizeBlockIds(blocks),
  };
}
