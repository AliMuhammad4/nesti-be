import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLawyerInvestorGeneratedBlocks,
  canonicalizeLawyerInvestorDraft,
  LAWYER_INVESTOR_BLOCK_TYPES,
  LAWYER_INVESTOR_DESIGN_VERSION,
} from '../services/publicProfile/lawyerInvestorStorefrontContract.js';
import {
  canonicalizeStorefrontDraft,
  createGeneratedDraftRevision,
  createPublishedRevision,
} from '../services/publicProfile/storefrontService.js';
import {
  allowedStorefrontBlockTypes,
  validateStorefrontDraftForRole,
} from '../services/publicProfile/storefrontValidation.js';
import { applyGeneratedStorefrontDraft } from '../services/publicProfile/professionalDashboardService.js';

const investorDraft = (blocks) => ({
  template: { id: 'lawyer-investor', version: '1' },
  blocks,
});

const block = (type, id = type, content = {}, layout = {}, style = {}) => ({
  id,
  type,
  data: { enabled: true, content, layout, style },
});

test('Lawyer Investor policy exposes only the ten contracted block types', () => {
  assert.deepEqual(
    allowedStorefrontBlockTypes('lawyer', 'lawyer-investor'),
    LAWYER_INVESTOR_BLOCK_TYPES,
  );

  for (const type of ['testimonials', 'expertise', 'faq', 'who-we-help']) {
    const result = validateStorefrontDraftForRole(investorDraft([
      block('hero'),
      block(type),
      block('footer'),
    ]), 'lawyer');
    assert.match(result.error.message, /Unsupported storefront block type/);
  }
});

test('Lawyer Investor accepts reordered and duplicate middle blocks but requires one hero and footer', () => {
  const accepted = validateStorefrontDraftForRole(investorDraft([
    block('footer'),
    block('services', 'services-secondary', { items: [{ id: 'refinance', title: 'Refinance' }] }),
    block('about', 'about-secondary'),
    block('hero'),
    block('services', 'services-primary', { items: [{ id: 'acquire', title: 'Acquire' }] }),
    block('about', 'about-primary'),
  ]), 'lawyer');
  assert.equal(accepted.error, undefined);

  const duplicateHero = validateStorefrontDraftForRole(investorDraft([
    block('hero', 'hero-one'),
    block('hero', 'hero-two'),
    block('footer'),
  ]), 'lawyer');
  assert.match(duplicateHero.error.message, /exactly one hero/);

  const missingFooter = validateStorefrontDraftForRole(investorDraft([
    block('hero'),
  ]), 'lawyer');
  assert.match(missingFooter.error.message, /exactly one footer/);
});

test('Lawyer Investor semantic collections enforce item shape and limits', () => {
  const cases = [
    ['services', 'items', 'title', 6],
    ['practice-areas', 'items', 'title', 6],
    ['role-details', 'highlights', 'title', 6],
    ['guidance', 'steps', 'title', 6],
    ['footer', 'items', 'label', 8],
  ];

  for (const [type, key, requiredText, limit] of cases) {
    const items = Array.from({ length: limit + 1 }, (_, index) => ({
      id: `${type.replaceAll('-', '_')}_${index}`,
      [requiredText]: `Item ${index}`,
    }));
    const result = validateStorefrontDraftForRole(investorDraft([
      block('hero'),
      ...(type === 'footer' ? [] : [block(type, type, { [key]: items })]),
      block('footer', 'footer', type === 'footer' ? { [key]: items } : {}),
    ]), 'lawyer');
    assert.match(result.error.message, new RegExp(`no more than ${limit}`));
  }

  const malformed = validateStorefrontDraftForRole(investorDraft([
    block('hero'),
    block('services', 'services', { items: [{ description: 'Missing title' }] }),
    block('footer'),
  ]), 'lawyer');
  assert.match(malformed.error.message, /require a valid title/);

  const unsafeFooter = validateStorefrontDraftForRole(investorDraft([
    block('hero'),
    block('footer', 'footer', {
      items: [{ label: 'Unsafe', target: 'javascript:alert(1)' }],
    }),
  ]), 'lawyer');
  assert.ok(unsafeFooter.error);
});

test('Lawyer Investor semantics reject duplicate item IDs and malformed KPI controls', () => {
  const duplicateItems = validateStorefrontDraftForRole(investorDraft([
    block('hero'),
    block('services', 'services', {
      items: [
        { id: 'same', title: 'Acquisition' },
        { id: 'same', title: 'Refinancing' },
      ],
    }),
    block('footer'),
  ]), 'lawyer');
  assert.match(duplicateItems.error.message, /ids must be unique/);

  for (const content of [
    { metric_order: ['pipeline', 'pipeline'] },
    { hidden_metrics: ['unknown'] },
    { metric_icons: { pipeline: false } },
    { metric_labels: { cases: 42 } },
  ]) {
    const result = validateStorefrontDraftForRole(investorDraft([
      block('hero'),
      block('credentials', 'credentials', content),
      block('footer'),
    ]), 'lawyer');
    assert.ok(result.error);
  }

  const malformedSnapshot = validateStorefrontDraftForRole(investorDraft([
    block('hero'),
    block('practice-snapshot', 'snapshot', { markets_label: false }),
    block('footer'),
  ]), 'lawyer');
  assert.match(malformedSnapshot.error.message, /markets_label must be a string/);

  const malformedFooter = validateStorefrontDraftForRole(investorDraft([
    block('hero'),
    block('footer', 'footer', { show_phone: 'yes' }),
  ]), 'lawyer');
  assert.match(malformedFooter.error.message, /show_phone must be a boolean/);
});

test('Investor migration repairs nonnumeric versions and legacy top-level settings', () => {
  const migrated = canonicalizeLawyerInvestorDraft(investorDraft([
    {
      id: 'legacy-hero',
      type: 'hero',
      enabled: false,
      content: { investor_design_version: 'not-a-number', heading: 'Legacy heading' },
      settings: { mediaPosition: 'none' },
      style: { background: '#112233' },
    },
    {
      id: 'legacy-services',
      type: 'services',
      content: { items: [{ title: 'Acquisition review' }, { id: 'duplicate', title: 'One' }, { id: 'duplicate', title: 'Two' }] },
      settings: { columns: '2' },
    },
    block('footer'),
  ]));

  const hero = migrated.blocks.find((entry) => entry.id === 'legacy-hero');
  const services = migrated.blocks.find((entry) => entry.id === 'legacy-services');
  assert.equal(hero.data.enabled, false);
  assert.equal(hero.data.content.investor_design_version, LAWYER_INVESTOR_DESIGN_VERSION);
  assert.equal(hero.data.layout.mediaPosition, 'portrait');
  assert.equal(hero.data.style.background, '#112233');
  assert.equal(new Set(services.data.content.items.map((item) => item.id)).size, 3);
  assert.equal(services.data.layout.columns, '2');
  assert.equal('settings' in services, false);
});

test('legacy Investor migration is idempotent and preserves existing authored data', () => {
  const legacy = investorDraft([
    block(
      'hero',
      'custom-hero',
      { heading: 'Custom investor heading' },
      { alignment: 'right' },
      { background: '#112233' },
    ),
    block('services', 'services-two', { items: [{ title: 'Second service group' }] }),
    block('services', 'services-one', { items: [{ title: 'First service group' }] }),
    block('testimonials', 'legacy-reviews', { items: [{ title: 'Remove' }] }),
    block('footer', 'custom-footer', { items: [{ label: 'Contact', target: '#contact' }] }),
  ]);

  const migrated = canonicalizeLawyerInvestorDraft(legacy);
  const migratedAgain = canonicalizeLawyerInvestorDraft(migrated);

  assert.deepEqual(migratedAgain, migrated);
  assert.equal(migrated.blocks.some((entry) => entry.type === 'testimonials'), false);
  assert.deepEqual(
    migrated.blocks.filter((entry) => entry.type === 'services').map((entry) => entry.id),
    ['services-two', 'services-one'],
  );
  assert.equal(migrated.blocks.find((entry) => entry.id === 'custom-hero').data.content.heading, 'Custom investor heading');
  assert.deepEqual(migrated.blocks.find((entry) => entry.id === 'custom-hero').data.layout, {
    alignment: 'right',
    padding: 'large',
    width: 'full',
    columns: '2',
    mediaPosition: 'portrait',
    animationType: 'fade',
    animationDuration: 'slow',
    animationIntensity: 'subtle',
  });
  assert.equal(migrated.blocks.find((entry) => entry.id === 'custom-hero').data.style.background, '#112233');
  assert.equal(
    migrated.blocks.find((entry) => entry.type === 'hero').data.content.investor_design_version,
    LAWYER_INVESTOR_DESIGN_VERSION,
  );
  LAWYER_INVESTOR_BLOCK_TYPES.forEach((type) => {
    assert.ok(migrated.blocks.some((entry) => entry.type === type), `${type} should be restored`);
  });
});

test('current Investor migration preserves intentional deletions, duplicate sections, and order', () => {
  const current = investorDraft([
    block('footer', 'footer-custom'),
    block('services', 'services-b'),
    block('hero', 'hero-custom', { investor_design_version: LAWYER_INVESTOR_DESIGN_VERSION }),
    block('services', 'services-a'),
    block('testimonials', 'stale-reviews'),
  ]);

  const migrated = canonicalizeLawyerInvestorDraft(current);
  assert.deepEqual(
    migrated.blocks.map((entry) => entry.id),
    ['footer-custom', 'services-b', 'hero-custom', 'services-a'],
  );
  assert.equal(migrated.blocks.some((entry) => entry.type === 'about'), false);
});

test('version 6 Investor drafts preserve intentional structure while upgrading presentation defaults', () => {
  const current = investorDraft([
    block('hero', 'hero-v6', { investor_design_version: 6 }, { mediaPosition: 'none' }),
    block('services', 'services-a'),
    block('services', 'services-b'),
    block('credentials', 'credentials-v6', {}, { columns: '3' }),
    block('footer', 'footer-v6'),
  ]);

  const migrated = canonicalizeLawyerInvestorDraft(current);
  assert.deepEqual(migrated.blocks.map((entry) => entry.id), [
    'hero-v6',
    'practice-snapshot-3',
    'services-a',
    'services-b',
    'credentials-v6',
    'footer-v6',
  ]);
  assert.equal(migrated.blocks[0].data.content.investor_design_version, LAWYER_INVESTOR_DESIGN_VERSION);
  assert.equal(migrated.blocks[0].data.layout.mediaPosition, 'portrait');
  assert.equal(
    migrated.blocks.find((entry) => entry.id === 'credentials-v6').data.layout.columns,
    '4',
  );
});

test('Investor AI defaults produce a complete valid contract without testimonials', () => {
  const generated = {
    template_key: 'lawyer-investor',
    headline: 'Counsel for active investors',
    tagline: 'Disciplined support for repeat transactions.',
    about: 'A focused investor legal practice.',
    services: [{ title: 'Acquisition review', description: 'Review the deal.', cta_text: 'Start intake' }],
    storefront_blocks: createLawyerInvestorGeneratedBlocks({
      headline: 'Counsel for active investors',
      tagline: 'Disciplined support for repeat transactions.',
      about: 'A focused investor legal practice.',
      services: [{ title: 'Acquisition review', description: 'Review the deal.', cta_text: 'Start intake' }],
    }),
    brand_kit: {},
  };
  const revision = createGeneratedDraftRevision(generated);
  const validation = validateStorefrontDraftForRole({
    blocks: revision.blocks,
    brandKit: revision.brandKit,
    template: revision.template,
  }, 'lawyer');

  assert.equal(validation.error, undefined);
  assert.deepEqual(revision.blocks.map((entry) => entry.type), LAWYER_INVESTOR_BLOCK_TYPES);
  assert.equal(revision.blocks.some((entry) => entry.type === 'testimonials'), false);
  for (const type of LAWYER_INVESTOR_BLOCK_TYPES) {
    assert.ok(
      Object.keys(revision.blocks.find((entry) => entry.type === type).data.content).length,
      `${type} should contain generated or safe canonical content`,
    );
  }
});

test('generation persistence isolates live public-profile copy until publish', () => {
  const profile = {
    headline: 'Published headline',
    tagline: 'Published tagline',
    about: 'Published about',
    services: [{ title: 'Published service' }],
    seo_meta: { title: 'Published SEO' },
    storefront: {},
  };
  const before = {
    headline: profile.headline,
    tagline: profile.tagline,
    about: profile.about,
    services: profile.services,
    seo_meta: profile.seo_meta,
  };
  const revision = createGeneratedDraftRevision({
    template_key: 'lawyer-investor',
    headline: 'Draft headline',
    tagline: 'Draft tagline',
    about: 'Draft about',
    services: [],
    storefront_blocks: createLawyerInvestorGeneratedBlocks(),
    brand_kit: {},
  });

  applyGeneratedStorefrontDraft(profile, revision, 'lawyer-investor');

  assert.deepEqual({
    headline: profile.headline,
    tagline: profile.tagline,
    about: profile.about,
    services: profile.services,
    seo_meta: profile.seo_meta,
  }, before);
  assert.equal(profile.storefront.draft, revision);
});

test('published Investor snapshots are made from the canonical revision', () => {
  const canonical = canonicalizeStorefrontDraft(investorDraft([
    block('hero', 'legacy-hero', { heading: 'Legacy' }),
    block('footer', 'legacy-footer'),
  ]));
  const published = createPublishedRevision(canonical, new Date('2026-08-27T00:00:00.000Z'));

  assert.equal(published.blocks.some((entry) => entry.type === 'testimonials'), false);
  assert.deepEqual(
    [...new Set(published.blocks.map((entry) => entry.type))],
    LAWYER_INVESTOR_BLOCK_TYPES,
  );
  assert.equal(published.published_at.toISOString(), '2026-08-27T00:00:00.000Z');
});
