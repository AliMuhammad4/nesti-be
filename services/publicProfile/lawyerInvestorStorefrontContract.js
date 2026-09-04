export const LAWYER_INVESTOR_TEMPLATE_ID = 'lawyer-investor';
export const LAWYER_INVESTOR_DESIGN_VERSION = 11;

export const LAWYER_INVESTOR_BLOCK_TYPES = Object.freeze([
  'hero',
  'about',
  'practice-snapshot',
  'services',
  'role-details',
  'practice-areas',
  'guidance',
  'credentials',
  'cta',
  'footer',
]);

const DEFAULT_SERVICES = Object.freeze([
  { id: 'investor-service-acquisition', title: 'Acquisition review', description: 'Review agreements, conditions, title considerations, and closing requirements before the transaction advances.', icon: 'contract', link_disabled: true },
  { id: 'investor-service-refinance', title: 'Refinancing and lender work', description: 'Coordinate lender instructions, payouts, registrations, signing, and funding requirements.', icon: 'dollar', link_disabled: true },
  { id: 'investor-service-entity', title: 'Entity and ownership changes', description: 'Organize corporation, partnership, beneficial ownership, and transfer details for legal review.', icon: 'building', link_disabled: true },
  { id: 'investor-service-portfolio', title: 'Portfolio title support', description: 'Address title, registration, discharge, and ownership issues across repeat or multi-property files.', icon: 'landmark', link_disabled: true },
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function investorServices(generated = {}) {
  if (!Array.isArray(generated.services) || !generated.services.length) {
    return clone(DEFAULT_SERVICES);
  }
  return generated.services.slice(0, 6).map((service, index) => ({
    id: service.id || `investor-service-generated-${index + 1}`,
    title: service.title || '',
    description: service.description || '',
    cta_text: service.cta_text || 'Learn More',
    link_disabled: true,
  }));
}

export function createLawyerInvestorGeneratedBlocks(generated = {}) {
  const definitions = [
    {
      type: 'hero',
      content: {
        investor_design_version: LAWYER_INVESTOR_DESIGN_VERSION,
        eyebrow: 'Investor transaction counsel',
        heading: generated.headline || 'Transaction counsel for active investors',
        body: generated.tagline || 'Structured legal support for acquisitions, refinances, assignments, entity transfers, and portfolio title work.',
        primary_cta_label: 'Start investor intake',
        cta_label: 'Book a strategy call',
      },
      settings: { alignment: 'left', padding: 'large', width: 'full', columns: '2', mediaPosition: 'portrait', animationType: 'fade', animationDuration: 'slow', animationIntensity: 'subtle' },
      style: { background: '#20252b', textColor: '#ffffff', radius: 'none', shadow: 'none' },
    },
    {
      type: 'about',
      content: {
        eyebrow: 'Investor-focused legal practice',
        heading: 'Legal clarity for repeat transactions',
        body: generated.about || 'A disciplined legal process helps investors move from agreement review to registration with fewer surprises, clearer responsibilities, and better-prepared files.',
      },
      settings: { padding: 'large', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '#20252b' },
    },
    {
      type: 'practice-snapshot',
      content: {
        eyebrow: 'Investor practice snapshot',
        heading: 'A practice built for active portfolios',
        body: 'A concise view of transaction focus, service markets, and consultation languages.',
        practice_focus_label: 'Investor practice focus',
        practice_focus_subtitle: 'Where counsel is concentrated',
        markets_label: 'Markets served',
        markets_subtitle: 'Locations and transaction contexts',
        languages_label: 'Languages spoken',
        languages_subtitle: 'Consultation accessibility',
      },
      settings: { columns: '3', padding: 'large', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '#20252b' },
    },
    {
      type: 'services',
      content: {
        eyebrow: 'Investor legal services',
        heading: 'Support across the transaction lifecycle',
        body: 'Choose the workstream that matches the deal, ownership structure, financing, and closing timeline.',
        resource_label: 'Transaction workstreams',
        items: investorServices(generated),
      },
      settings: { columns: '2', padding: 'large', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '#20252b' },
    },
    {
      type: 'role-details',
      content: {
        eyebrow: 'Transaction safeguards',
        heading: 'Protect the structure, timing, and exit',
        body: 'Investor files often involve layered financing, entities, tenancies, assignments, or compressed timelines. Surface the legal requirements early.',
        cta_label: 'Discuss the transaction',
        highlights: [
          { id: 'investor-safeguard-structure', title: 'Ownership structure', text: 'Confirm the purchasing entity, signing authority, beneficial ownership, and registration plan.', icon: 'building' },
          { id: 'investor-safeguard-timing', title: 'Conditions and timing', text: 'Track review periods, financing requirements, document delivery, funds, and closing deadlines.', icon: 'contract' },
          { id: 'investor-safeguard-title', title: 'Title and exit readiness', text: 'Identify registrations, discharges, restrictions, and title issues that can affect financing or resale.', icon: 'shield' },
        ],
      },
      settings: { columns: '3', padding: 'large', animationType: 'fade', animationDuration: 'slow' },
      style: { background: '', textColor: '#20252b' },
    },
    {
      type: 'practice-areas',
      content: {
        eyebrow: 'Investor workstreams',
        heading: 'Focused real estate legal support',
        body: 'A practical scope for active investors, ownership groups, and repeat transaction files.',
        items: [
          { id: 'investor-practice-purchases', title: 'Investment purchases', description: 'Agreement, title, financing, closing, and registration support for acquisitions.', icon: 'building' },
          { id: 'investor-practice-sales', title: 'Investment sales', description: 'Prepare the legal file for discharge, closing adjustments, deliverables, and completion.', icon: 'contract' },
          { id: 'investor-practice-refinancing', title: 'Portfolio refinancing', description: 'Coordinate lender instructions, payouts, registrations, and funding conditions.', icon: 'dollar' },
          { id: 'investor-practice-assignments', title: 'Assignments and transfers', description: 'Review transaction structure, consents, documents, and closing obligations.', icon: 'file' },
          { id: 'investor-practice-entities', title: 'Entity ownership', description: 'Organize corporate ownership, authority, registrations, and related documentation.', icon: 'landmark' },
          { id: 'investor-practice-title', title: 'Title strategy', description: 'Resolve title, discharge, registration, and ownership concerns before they delay a deal.', icon: 'shield' },
        ],
      },
      settings: { columns: '3', padding: 'large', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '#20252b' },
    },
    {
      type: 'guidance',
      content: {
        eyebrow: 'Organized investor intake',
        heading: 'Move each file through a clear legal process',
        body: 'Prepare the transaction facts early so legal review can focus on risks, requirements, and the next decision.',
        steps: [
          { id: 'investor-step-deal', title: 'Share the deal', text: 'Provide the agreement, property, entity, financing, and target closing details.', icon: 'notebook' },
          { id: 'investor-step-structure', title: 'Confirm the structure', text: 'Clarify ownership, signing authority, lender requirements, and transaction-specific conditions.', icon: 'building' },
          { id: 'investor-step-review', title: 'Resolve legal requirements', text: 'Address title, documents, registrations, discharges, funds, and closing deliverables.', icon: 'shield' },
          { id: 'investor-step-close', title: 'Complete and report', text: 'Coordinate signing, registration, funding, completion, and final reporting for the file.', icon: 'gavel' },
        ],
      },
      settings: { columns: '4', padding: 'large', animationType: 'slide-up', animationIntensity: 'subtle' },
      style: { background: '', textColor: '#20252b' },
    },
    {
      type: 'credentials',
      content: {
        eyebrow: 'Professional standing',
        heading: 'Investor practice at a glance',
        body: 'Current practice activity and experience for repeat transaction clients.',
      },
      settings: { columns: '4', padding: 'medium', animationType: 'fade', animationDuration: 'slow' },
      style: { background: '', textColor: '#20252b' },
    },
    {
      type: 'cta',
      content: {
        eyebrow: 'Next transaction',
        heading: 'Bring the next deal into focus',
        body: 'Share the property, agreement, entity, financing, and target closing date for a structured response.',
        cta_label: 'Start investor intake',
        secondary_cta_label: 'Book a strategy call',
        helper_text: '',
      },
      settings: { padding: 'large', animationType: 'fade', animationIntensity: 'subtle' },
      style: { background: '#007f95', textColor: '#ffffff' },
    },
    {
      type: 'footer',
      content: {
        eyebrow: 'Investor transaction lawyer',
        heading: generated.business_name || '',
        body: 'Disciplined legal support for acquisitions, refinancing, ownership changes, title work, and repeat closings.',
        role_label: 'Investor transaction counsel',
        resource_heading: 'Investor legal desk',
        contact_heading: 'Start a transaction',
        disclaimer: 'Do not send confidential information until the lawyer confirms representation.',
        show_email: true,
        show_phone: true,
        show_booking: true,
        items: [
          { id: 'investor-footer-about', label: 'About', target: '#about' },
          { id: 'investor-footer-snapshot', label: 'Snapshot', target: '#practice-snapshot' },
          { id: 'investor-footer-services', label: 'Services', target: '#services' },
          { id: 'investor-footer-safeguards', label: 'Safeguards', target: '#buyer-protection' },
          { id: 'investor-footer-practice', label: 'Practice areas', target: '#practice-areas' },
          { id: 'investor-footer-guidance', label: 'Process', target: '#guidance' },
          { id: 'investor-footer-intake', label: 'Start intake', target: '#contact' },
        ],
      },
      settings: { padding: 'large' },
      style: { background: '#12171c', textColor: '#ffffff' },
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
  return createLawyerInvestorGeneratedBlocks(generated).map((block) => ({
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

function blockContent(block = {}) {
  return block?.data?.content || block?.content || {};
}

export function lawyerInvestorDesignVersion(blocks = []) {
  const source = Array.isArray(blocks) ? blocks : [];
  const versions = source
    .map((block) => Number(blockContent(block).investor_design_version))
    .filter((version) => Number.isFinite(version) && version >= 0);
  if (versions.length) return Math.max(...versions);
  return source.length && !source.some((block) => block?.type === 'hero') ? 6 : 0;
}

function normalizedLegacyItemId(type, key, item, index) {
  const raw = String(item?.id || '').trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(raw)) return raw;
  return `${type}-${key}-${index + 1}`;
}

function normalizeLegacyCollectionIds(type, content = {}) {
  const collectionKey = {
    services: 'items',
    'practice-areas': 'items',
    'role-details': 'highlights',
    guidance: 'steps',
    footer: 'items',
  }[type];
  if (!collectionKey || !Array.isArray(content[collectionKey])) return content;
  const used = new Set();
  return {
    ...content,
    [collectionKey]: content[collectionKey].map((item, index) => {
      let id = normalizedLegacyItemId(type, collectionKey, item, index);
      let suffix = 2;
      while (used.has(id)) {
        id = `${normalizedLegacyItemId(type, collectionKey, item, index)}-${suffix}`;
        suffix += 1;
      }
      used.add(id);
      return { ...item, id };
    }),
  };
}

function normalizeBlockShape(block, { legacy = false } = {}) {
  const type = block?.type || block?.data?.type;
  let content = clone(block?.data?.content || block?.content || {});
  if (type === 'footer' && Array.isArray(content.items)) {
    content = {
      ...content,
      items: content.items.map((item) => {
        const descriptor = `${item?.id || ''} ${item?.label || ''} ${item?.title || ''}`;
        if (item?.target === '#buyer-toolkit') return { ...item, target: '#services' };
        if (item?.target === '#services' && /practice/i.test(descriptor)) {
          return { ...item, target: '#practice-areas' };
        }
        return item;
      }),
    };
  }
  return {
    id: block?.id,
    type,
    data: {
      enabled: block?.data?.enabled ?? block?.enabled ?? true,
      content: legacy ? normalizeLegacyCollectionIds(block?.type, content) : content,
      layout: clone(block?.data?.layout || block?.settings || block?.layout || {}),
      style: clone(block?.data?.style || block?.style || {}),
    },
  };
}

function normalizeLegacyBlockIds(blocks) {
  const used = new Set();
  return blocks.map((block, index) => {
    const base = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(block.id || ''))
      ? String(block.id)
      : `${block.type}-${index + 1}`;
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
  const normalizedExisting = normalizeBlockShape(existing, { legacy: true });
  const normalizedLayout = clone(normalizedExisting.data?.layout || {});
  if (existing.type === 'hero' && normalizedLayout.mediaPosition === 'none') {
    normalizedLayout.mediaPosition = fallback.data?.layout?.mediaPosition || 'portrait';
  }
  if (existing.type === 'credentials' && [2, 3, '2', '3'].includes(normalizedLayout.columns)) {
    normalizedLayout.columns = fallback.data?.layout?.columns || '4';
  }
  return {
    ...clone(fallback),
    ...clone(normalizedExisting),
    id: normalizedExisting.id || fallback.id,
    type: fallback.type,
    data: {
      ...clone(fallback.data || {}),
      ...clone(normalizedExisting.data || {}),
      enabled: normalizedExisting.data?.enabled ?? fallback.data?.enabled ?? true,
      content: normalizeLegacyCollectionIds(existing.type, {
        ...clone(fallback.data?.content || {}),
        ...clone(normalizedExisting.data?.content || {}),
        investor_design_version: LAWYER_INVESTOR_DESIGN_VERSION,
      }),
      layout: {
        ...clone(fallback.data?.layout || {}),
        ...normalizedLayout,
      },
      style: {
        ...clone(fallback.data?.style || {}),
        ...clone(normalizedExisting.data?.style || {}),
      },
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
  const fallbackIndex = LAWYER_INVESTOR_BLOCK_TYPES.indexOf(fallback.type);
  let insertionIndex = next.findIndex((block) => (
    LAWYER_INVESTOR_BLOCK_TYPES.indexOf(block?.type) > fallbackIndex
  ));
  if (insertionIndex < 0) insertionIndex = next.length;
  next.splice(insertionIndex, 0, {
    ...clone(fallback),
    id: uniqueDefaultId(fallback.id, next),
  });
  return next;
}

export function canonicalizeLawyerInvestorDraft(draft, generated = {}) {
  if (String(draft?.template?.id || '').trim() !== LAWYER_INVESTOR_TEMPLATE_ID) {
    return draft;
  }

  let blocks = (Array.isArray(draft?.blocks) ? draft.blocks : [])
    .filter(Boolean)
    .map((block) => normalizeBlockShape(clone(block)))
    .filter((block) => LAWYER_INVESTOR_BLOCK_TYPES.includes(block.type));

  const currentVersion = lawyerInvestorDesignVersion(blocks);
  blocks = blocks.map((block) => normalizeBlockShape(block, {
    legacy: currentVersion < LAWYER_INVESTOR_DESIGN_VERSION,
  }));
  if (currentVersion >= 10 && currentVersion < LAWYER_INVESTOR_DESIGN_VERSION) {
    blocks = blocks.map((block) => ({
      ...block,
      data: {
        ...block.data,
        content: {
          ...(block.data?.content || {}),
          investor_design_version: LAWYER_INVESTOR_DESIGN_VERSION,
        },
      },
    }));
  } else if (currentVersion < 10) {
    const defaults = revisionDefaults(generated);
    const defaultByType = new Map(defaults.map((block) => [block.type, block]));
    const mergedBlocks = blocks.map((block) => (
      defaultByType.has(block.type)
        ? mergeLegacyBlock(block, defaultByType.get(block.type))
        : block
    ));
    if (currentVersion < 6) {
      const firstByType = new Map();
      const extras = [];
      mergedBlocks.forEach((block) => {
        if (!firstByType.has(block.type)) firstByType.set(block.type, block);
        else extras.push(block);
      });
      blocks = LAWYER_INVESTOR_BLOCK_TYPES
        .map((type) => firstByType.get(type) || clone(defaultByType.get(type)))
        .filter(Boolean);
      const footerIndex = blocks.findIndex((block) => block.type === 'footer');
      blocks.splice(footerIndex < 0 ? blocks.length : footerIndex, 0, ...extras);
    } else {
      blocks = mergedBlocks;
      if (!blocks.some((block) => block.type === 'practice-snapshot')) {
        blocks = insertMissingBlock(blocks, defaultByType.get('practice-snapshot'));
      }
    }
    blocks = blocks.map((block) => ({
      ...block,
      data: {
        ...block.data,
        content: normalizeLegacyCollectionIds(block.type, block.data?.content || {}),
      },
    }));
  }
  blocks = normalizeLegacyBlockIds(blocks);

  return {
    ...draft,
    blocks,
  };
}
