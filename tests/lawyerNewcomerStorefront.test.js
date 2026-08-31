import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeLawyerNewcomerDraft,
  createLawyerNewcomerGeneratedBlocks,
  LAWYER_NEWCOMER_BLOCK_TYPES,
  LAWYER_NEWCOMER_DESIGN_VERSION,
  LAWYER_NEWCOMER_TEMPLATE_ID,
} from '../services/publicProfile/lawyerNewcomerStorefrontContract.js';
import { defaultStorefrontTemplateIdForRole } from '../services/publicProfile/storefrontTemplateDefaults.js';
import { generateDefaultStorefrontBlocks } from '../services/publicProfile/storefrontAiGenerationService.js';
import {
  canonicalizeStorefrontDraft,
  createGeneratedDraftRevision,
  createPublishedRevision,
  serializeStorefrontRevision,
} from '../services/publicProfile/storefrontService.js';
import {
  allowedStorefrontBlockTypes,
  validateStorefrontDraftForRole,
} from '../services/publicProfile/storefrontValidation.js';
import {
  getStorefrontTemplateTier,
  userHasStorefrontTemplateAccess,
} from '../services/billing/storefrontTemplatePurchases.js';
import { applyGeneratedStorefrontDraft } from '../services/publicProfile/professionalDashboardService.js';

const block = (type, id = type, content = {}, layout = {}, style = {}) => ({
  id,
  type,
  data: { enabled: true, content, layout, style },
});

const newcomerDraft = (blocks, version = '1') => ({
  template: { id: LAWYER_NEWCOMER_TEMPLATE_ID, version },
  blocks,
});

test('lawyers default to Newcomer while other backend role defaults remain stable', () => {
  assert.equal(defaultStorefrontTemplateIdForRole('lawyer'), LAWYER_NEWCOMER_TEMPLATE_ID);
  assert.equal(defaultStorefrontTemplateIdForRole('agent'), 'agent-investor');
  assert.equal(defaultStorefrontTemplateIdForRole('mortgage_broker'), 'mortgage_broker-classic');
});

test('Newcomer AI defaults produce the canonical nine-layer legal-safe contract', () => {
  const blocks = generateDefaultStorefrontBlocks('lawyer', LAWYER_NEWCOMER_TEMPLATE_ID, {
    headline: 'Understand your new home closing',
    tagline: 'Plain-language support for each legal step.',
    about: 'A clear introduction to purchase closing requirements.',
    business_name: 'Example Legal',
    services: [{
      title: 'Agreement review',
      description: 'Review the transaction documents.',
      cta_text: 'Start an inquiry',
    }],
  });

  assert.deepEqual(blocks.map((entry) => entry.type), LAWYER_NEWCOMER_BLOCK_TYPES);
  assert.equal(blocks.length, 9);
  assert.equal(new Set(blocks.map((entry) => entry.id)).size, blocks.length);
  assert.equal(blocks[0].content.newcomer_design_version, LAWYER_NEWCOMER_DESIGN_VERSION);
  assert.equal(blocks.find((entry) => entry.type === 'testimonials').content.items, undefined);
  assert.match(
    blocks.find((entry) => entry.type === 'cta').content.helper_text,
    /does not create a lawyer-client relationship/i,
  );

  const collectionIds = blocks.flatMap((entry) => {
    const content = entry.content || {};
    return [...(content.items || []), ...(content.steps || [])].map((item) => item.id);
  });
  assert.equal(new Set(collectionIds).size, collectionIds.length);
  assert.ok(blocks.every((entry) => (
    !['#f0fdf4', '#fff7ed', '#0f766e', '#134e4a'].includes(
      String(entry.style?.background || '').toLowerCase(),
    )
  )));
});

test('legacy five-layer Newcomer drafts upgrade idempotently without losing authored data or order', () => {
  const legacy = newcomerDraft([
    {
      id: 'custom-hero',
      type: 'hero',
      enabled: false,
      content: { heading: 'My custom newcomer heading' },
      settings: { alignment: 'right' },
      style: { background: '#112233' },
    },
    block('guidance', 'custom-guide', {
      heading: 'My process',
      steps: [
        { id: 'same', title: 'First', text: 'First custom step' },
        { id: 'same', title: 'Second', text: 'Second custom step' },
      ],
    }),
    block('practice-areas', 'custom-practice', {
      heading: 'My work',
      items: [{ title: 'Custom purchase support', description: 'Authored details' }],
    }),
    block('testimonials', 'custom-stories', { heading: 'Real client feedback' }),
    block('cta', 'custom-cta', { heading: 'Contact my office' }),
  ]);

  const migrated = canonicalizeLawyerNewcomerDraft(legacy);
  const migratedAgain = canonicalizeLawyerNewcomerDraft(migrated);
  const authoredIds = migrated.blocks
    .filter((entry) => entry.id.startsWith('custom-'))
    .map((entry) => entry.id);

  assert.deepEqual(migratedAgain, migrated);
  assert.equal(migrated.template.version, String(LAWYER_NEWCOMER_DESIGN_VERSION));
  assert.deepEqual(authoredIds, [
    'custom-hero',
    'custom-guide',
    'custom-practice',
    'custom-stories',
    'custom-cta',
  ]);
  assert.deepEqual(
    [...new Set(migrated.blocks.map((entry) => entry.type))].sort(),
    [...LAWYER_NEWCOMER_BLOCK_TYPES].sort(),
  );
  assert.equal(
    migrated.blocks.find((entry) => entry.id === 'custom-hero').data.content.heading,
    'My custom newcomer heading',
  );
  assert.equal(
    migrated.blocks.find((entry) => entry.id === 'custom-hero').data.enabled,
    false,
  );
  assert.equal(
    migrated.blocks.find((entry) => entry.id === 'custom-hero').data.style.background,
    '#112233',
  );
  const stepIds = migrated.blocks
    .find((entry) => entry.id === 'custom-guide')
    .data.content.steps
    .map((item) => item.id);
  assert.equal(new Set(stepIds).size, stepIds.length);
  assert.ok(stepIds.every(Boolean));
  assert.ok(
    migrated.blocks
      .find((entry) => entry.id === 'custom-practice')
      .data.content.items[0].id,
  );
});

test('version-two Newcomer scaffolds receive missing collections and known empty copy', () => {
  const versionTwo = newcomerDraft([
    block('hero', 'hero-1', {
      heading: 'Keep this hero',
      newcomer_design_version: 2,
    }),
    block('about', 'about-scaffold', {
      heading: 'About',
      body: '',
      seller_about_layout_version: 2,
    }),
    block('guidance', 'guidance-2', { heading: 'My guide' }, {}, {
      background: '#f0fdf4',
    }),
    block('practice-areas', 'practice-areas-3', { heading: 'My practice' }, {}, {
      background: '#abcdef',
    }),
    block('footer', 'footer-1', {}),
  ], '2');

  const migrated = canonicalizeLawyerNewcomerDraft(versionTwo);
  assert.equal(migrated.template.version, String(LAWYER_NEWCOMER_DESIGN_VERSION));
  assert.equal(
    migrated.blocks.find((entry) => entry.id === 'hero-1').data.content.heading,
    'Keep this hero',
  );
  assert.ok(migrated.blocks.find((entry) => entry.id === 'about-scaffold').data.content.body);
  assert.ok(
    migrated.blocks.find((entry) => entry.id === 'guidance-2').data.content.steps.length,
  );
  assert.ok(
    migrated.blocks.find((entry) => entry.id === 'practice-areas-3').data.content.items.length,
  );
  assert.ok(migrated.blocks.find((entry) => entry.id === 'footer-1').data.content.items.length);
  assert.equal(
    migrated.blocks.find((entry) => entry.id === 'guidance-2').data.style.background,
    '',
  );
  assert.equal(
    migrated.blocks.find((entry) => entry.id === 'practice-areas-3').data.style.background,
    '#abcdef',
  );
});

test('legacy default Newcomer scaffold returns to canonical layer order', () => {
  const legacyDefault = newcomerDraft([
    block('hero', 'hero-1', { heading: 'Hero' }),
    block('guidance', 'guidance-2', { heading: 'Guide' }),
    block('practice-areas', 'practice-areas-3', { heading: 'Practice' }),
    block('testimonials', 'testimonials-4', { heading: 'Stories' }),
    block('cta', 'cta-5', { heading: 'Contact' }),
  ]);

  assert.deepEqual(
    canonicalizeLawyerNewcomerDraft(legacyDefault).blocks.map((entry) => entry.type),
    LAWYER_NEWCOMER_BLOCK_TYPES,
  );
});

test('current Newcomer drafts preserve intentional deletions, duplicate sections, and custom order', () => {
  const current = newcomerDraft([
    block('cta', 'cta-first'),
    block('services', 'services-two'),
    block('services', 'services-one'),
    block('footer', 'footer-last'),
  ], String(LAWYER_NEWCOMER_DESIGN_VERSION));

  const canonical = canonicalizeLawyerNewcomerDraft(current);
  assert.deepEqual(
    canonical.blocks.map((entry) => entry.id),
    ['cta-first', 'services-two', 'services-one', 'footer-last'],
  );
  assert.equal(canonical.blocks.some((entry) => entry.type === 'hero'), false);
  assert.equal(canonical.blocks.some((entry) => entry.type === 'about'), false);
});

test('legacy Newcomer credentials migrate to four desktop columns', () => {
  const migrated = canonicalizeLawyerNewcomerDraft(newcomerDraft([
    block('credentials', 'credentials-saved', {}, { columns: '3' }),
  ], String(LAWYER_NEWCOMER_DESIGN_VERSION - 1)));
  assert.equal(
    migrated.blocks.find((entry) => entry.type === 'credentials').data.layout.columns,
    '4',
  );

  const currentCustom = canonicalizeLawyerNewcomerDraft(newcomerDraft([
    block('credentials', 'credentials-custom', {
      newcomer_design_version: LAWYER_NEWCOMER_DESIGN_VERSION,
    }, { columns: '3' }),
  ], String(LAWYER_NEWCOMER_DESIGN_VERSION)));
  assert.equal(
    currentCustom.blocks.find((entry) => entry.type === 'credentials').data.layout.columns,
    '3',
  );
});

test('Newcomer validation allows flexible structure and enforces its block and item contract', () => {
  assert.deepEqual(
    allowedStorefrontBlockTypes('lawyer', LAWYER_NEWCOMER_TEMPLATE_ID),
    LAWYER_NEWCOMER_BLOCK_TYPES,
  );

  const flexible = validateStorefrontDraftForRole(newcomerDraft([
    block('footer', 'footer-first'),
    block('services', 'services-two', {
      items: [{ id: 'service-two', title: 'Second service group' }],
    }),
    block('services', 'services-one', {
      items: [{ id: 'service-one', title: 'First service group' }],
    }),
  ], String(LAWYER_NEWCOMER_DESIGN_VERSION)), 'lawyer');
  assert.equal(flexible.error, undefined);

  const unsupported = validateStorefrontDraftForRole(newcomerDraft([
    block('expertise'),
  ], String(LAWYER_NEWCOMER_DESIGN_VERSION)), 'lawyer');
  assert.match(unsupported.error.message, /Unsupported storefront block type/);

  const duplicateItemIds = validateStorefrontDraftForRole(newcomerDraft([
    block('services', 'services', {
      items: [
        { id: 'duplicate', title: 'Agreement review' },
        { id: 'duplicate', title: 'Closing support' },
      ],
    }),
  ], String(LAWYER_NEWCOMER_DESIGN_VERSION)), 'lawyer');
  assert.match(duplicateItemIds.error.message, /item ids must be unique/);

  const tooManyTestimonials = validateStorefrontDraftForRole(newcomerDraft([
    block('testimonials', 'testimonials', {
      items: Array.from({ length: 9 }, (_, index) => ({
        id: `testimonial-${index + 1}`,
        client_name: `Client ${index + 1}`,
        text: 'A genuine client experience.',
        rating: 5,
      })),
    }),
  ], String(LAWYER_NEWCOMER_DESIGN_VERSION)), 'lawyer');
  assert.match(tooManyTestimonials.error.message, /no more than 8 items/);
});

test('Newcomer remains a free lawyer entitlement without changing Classic access', () => {
  const newcomerTier = getStorefrontTemplateTier(LAWYER_NEWCOMER_TEMPLATE_ID);
  const lawyerProfile = {
    professional_type: 'lawyer',
    storefront: { unlocked_template_ids: [] },
  };
  const agentProfile = {
    professional_type: 'agent',
    storefront: { unlocked_template_ids: [] },
  };

  assert.equal(newcomerTier.tier, 'free');
  assert.equal(newcomerTier.amount, 0);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, LAWYER_NEWCOMER_TEMPLATE_ID), true);
  assert.equal(userHasStorefrontTemplateAccess(agentProfile, LAWYER_NEWCOMER_TEMPLATE_ID), false);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, 'lawyer-classic'), true);
});

test('public Newcomer revisions retain only the safe palette migration marker', () => {
  const serialized = serializeStorefrontRevision({
    brandKit: {
      essentials: {
        lawyer_newcomer_brand_version: 5,
        internal_note: 'private',
      },
    },
  }, { publicView: true });
  assert.equal(serialized.brandKit.essentials.lawyer_newcomer_brand_version, 5);
  assert.equal(serialized.brandKit.essentials.internal_note, undefined);
});

test('Newcomer canonicalization leaves keyed Classic and unkeyed legacy lawyer drafts untouched', () => {
  const classic = {
    template: { id: 'lawyer-classic', version: '1' },
    blocks: [block('hero', 'classic-hero', { lawyer_classic_design_version: 2 })],
  };
  const unkeyed = {
    blocks: [
      block('hero', 'legacy-classic-hero', { heading: 'Historical Classic heading' }),
      block('expertise', 'legacy-classic-expertise'),
    ],
  };

  assert.deepEqual(canonicalizeStorefrontDraft(classic), classic);
  assert.deepEqual(canonicalizeStorefrontDraft(unkeyed), unkeyed);
});

test('Newcomer generation keeps current deletions and draft changes isolated until publish', () => {
  const previousRevision = {
    template: {
      id: LAWYER_NEWCOMER_TEMPLATE_ID,
      version: String(LAWYER_NEWCOMER_DESIGN_VERSION),
    },
    blocks: [block('services', 'only-service')],
    revision_version: 1,
  };
  const generated = {
    template_key: LAWYER_NEWCOMER_TEMPLATE_ID,
    headline: 'Draft newcomer headline',
    tagline: 'Draft newcomer summary',
    about: 'Draft newcomer overview',
    services: [{ title: 'Updated service', description: 'Updated details' }],
    storefront_blocks: createLawyerNewcomerGeneratedBlocks({
      headline: 'Draft newcomer headline',
      tagline: 'Draft newcomer summary',
      about: 'Draft newcomer overview',
      services: [{ title: 'Updated service', description: 'Updated details' }],
    }),
    brand_kit: {},
  };
  const revision = createGeneratedDraftRevision(
    generated,
    {},
    new Date('2026-08-28T00:00:00.000Z'),
    previousRevision.blocks,
    previousRevision,
  );
  const profile = {
    headline: 'Published headline',
    tagline: 'Published summary',
    about: 'Published overview',
    services: [{ title: 'Published service' }],
    seo_meta: { title: 'Published SEO' },
    storefront: {},
  };
  const liveBefore = {
    headline: profile.headline,
    tagline: profile.tagline,
    about: profile.about,
    services: profile.services,
    seo_meta: profile.seo_meta,
  };

  assert.deepEqual(revision.blocks.map((entry) => entry.id), ['only-service']);
  applyGeneratedStorefrontDraft(profile, revision, LAWYER_NEWCOMER_TEMPLATE_ID);
  assert.deepEqual({
    headline: profile.headline,
    tagline: profile.tagline,
    about: profile.about,
    services: profile.services,
    seo_meta: profile.seo_meta,
  }, liveBefore);

  const published = createPublishedRevision(
    revision,
    new Date('2026-08-29T00:00:00.000Z'),
  );
  revision.blocks[0].data.content.heading = 'Later draft edit';
  assert.notEqual(published.blocks[0].data.content.heading, 'Later draft edit');
  assert.equal(published.published_at.toISOString(), '2026-08-29T00:00:00.000Z');
});
