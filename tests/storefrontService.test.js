import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeStorefrontDraft,
  createDraftRevision,
  createGeneratedDraftRevision,
  createPublishedRevision,
  serializePublishedStorefront,
  serializeStorefrontDrafts,
  storefrontDrafts,
} from '../services/publicProfile/storefrontService.js';
import {
  generateStorefrontDraftSchema,
  saveStorefrontDraftSchema,
} from '../schemas/publicProfileSchemas.js';
import {
  allowedStorefrontBlockTypes,
  validateStorefrontDraftForRole,
} from '../services/publicProfile/storefrontValidation.js';
import { generateDefaultStorefrontBlocks } from '../services/publicProfile/storefrontAiGenerationService.js';
import {
  mergeProfileTestimonials,
  serializeProfileFeedback,
  toProfessionalProfileSummary,
} from '../services/publicProfile/professionalDashboardService.js';

test('storefront draft validation accepts bounded structured content', () => {
  const { error, value } = saveStorefrontDraftSchema.validate({
    draft: {
      blocks: [{
        id: 'hero',
        type: 'hero',
        data: {
          enabled: true,
          content: { heading: 'A business', image_url: 'https://cdn.example.com/hero.jpg' },
          layout: {
            alignment: 'center',
            padding: 'large',
            width: 'contained',
            columns: '4',
            animationType: 'slide-up',
            animationTrigger: 'scroll',
            animationDuration: 'medium',
            animationDelay: '160',
            animationIntensity: 'subtle',
          },
          style: { background: '#112233', textColor: '#ffffff', radius: 'large', shadow: 'medium' },
        },
      }],
      brandKit: { primary_color: '#112233' },
      template: { id: 'modern', version: '1' },
    },
  });

  assert.equal(error, undefined);
  assert.equal(value.draft.blocks[0].data.content.heading, 'A business');
  assert.equal(value.draft.blocks[0].data.layout.columns, '4');
  assert.equal(value.draft.blocks[0].data.layout.animationType, 'slide-up');
});

test('storefront draft validation accepts element editing metadata', () => {
  const { error, value } = saveStorefrontDraftSchema.validate({
    draft: {
      blocks: [{
        id: 'services',
        type: 'services',
        data: {
          content: {
            items: [{ id: 'item-service-1', title: 'Strategy', description: 'A focused plan.' }],
          },
          layout: { hiddenFields: ['content.body'] },
        },
      }],
    },
  });

  assert.equal(error, undefined);
  assert.equal(value.draft.blocks[0].data.content.items[0].id, 'item-service-1');
  assert.deepEqual(value.draft.blocks[0].data.layout.hiddenFields, ['content.body']);
});

test('storefront draft validation accepts page background in brand kit', () => {
  const { error, value } = saveStorefrontDraftSchema.validate({
    draft: {
      brandKit: {
        primary_color: '#0f766e',
        page_background: '#f1f5f9',
      },
    },
  });

  assert.equal(error, undefined);
  assert.equal(value.draft.brandKit.page_background, '#f1f5f9');
});

test('storefront draft validation preserves all editable brand settings', () => {
  const { error, value } = saveStorefrontDraftSchema.validate({
    draft: {
      brandKit: {
        logo_dark_url: 'https://cdn.example.com/logo-dark.svg',
        image_style: 'editorial',
        essentials: { service_area: 'Lahore' },
      },
    },
  });

  assert.equal(error, undefined);
  assert.equal(value.draft.brandKit.logo_dark_url, 'https://cdn.example.com/logo-dark.svg');
  assert.equal(value.draft.brandKit.image_style, 'editorial');
  assert.equal(value.draft.brandKit.essentials.service_area, 'Lahore');
});

test('template draft collection preserves legacy and per-template revisions', () => {
  const legacy = createDraftRevision({
    template: { id: 'agent-classic' },
    blocks: [{ id: 'hero-classic', type: 'hero', data: {} }],
  });
  const investor = createDraftRevision({
    template: { id: 'agent-investor' },
    blocks: [{ id: 'hero-investor', type: 'hero', data: {} }],
  });
  const newerClassic = createDraftRevision({
    template: { id: 'agent-classic' },
    blocks: [{ id: 'hero-classic-new', type: 'hero', data: {} }],
  });

  const drafts = storefrontDrafts({ draft: legacy, drafts: [investor, newerClassic] });
  const serialized = serializeStorefrontDrafts({ draft: legacy, drafts: [investor, newerClassic] });

  assert.equal(drafts.length, 2);
  assert.equal(drafts.find((draft) => draft.template.id === 'agent-classic').blocks[0].id, 'hero-classic-new');
  assert.deepEqual(serialized.map((draft) => draft.template.id).sort(), ['agent-classic', 'agent-investor']);
});

test('active storefront draft resolves the selected per-template revision before legacy draft', () => {
  const classic = createDraftRevision({
    template: { id: 'agent-classic' },
    blocks: [{ id: 'classic-hero', type: 'hero' }],
  });
  const community = createDraftRevision({
    template: { id: 'agent-community-expert' },
    blocks: [{ id: 'community-hero', type: 'hero' }],
  });

  const active = activeStorefrontDraft({
    draft: classic,
    drafts: [classic, community],
    active_template_id: 'agent-community-expert',
  });

  assert.equal(active.template.id, 'agent-community-expert');
  assert.equal(active.blocks[0].id, 'community-hero');
});

test('storefront draft validation allows repeated block types but rejects duplicate or unsafe IDs', () => {
  const repeatedType = saveStorefrontDraftSchema.validate({
    draft: {
      blocks: [
        { id: 'services-primary', type: 'services' },
        { id: 'services-copy', type: 'services' },
      ],
    },
  });
  assert.equal(repeatedType.error, undefined);

  const duplicate = saveStorefrontDraftSchema.validate({
    draft: {
      blocks: [
        { id: 'hero', type: 'hero' },
        { id: 'hero', type: 'services' },
      ],
    },
  });
  assert.ok(duplicate.error);

  const unsafeId = saveStorefrontDraftSchema.validate({
    draft: { blocks: [{ id: 'hero<script>', type: 'hero' }] },
  });
  assert.ok(unsafeId.error);

  const unknownBrandKit = saveStorefrontDraftSchema.validate({
    draft: { brandKit: { primary_color: '#112233', unexpected: 'value' } },
  });
  assert.ok(unknownBrandKit.error);
});

test('community expert AI draft has 14 valid blocks and preserves the full brand kit', () => {
  assert.equal(generateStorefrontDraftSchema.validate({
    template_key: 'agent-community-expert',
    brand_kit: {
      secondary_color: '#334155',
      font_family: 'Manrope',
    },
  }).error, undefined);

  const blocks = generateDefaultStorefrontBlocks('agent', 'agent-community-expert', {
    headline: 'Know the neighborhood',
    tagline: 'Local guidance',
    about: 'A community-focused agent.',
    services: [{ title: 'Relocation', description: 'Move locally.', cta_text: 'Learn More' }],
  });
  const revision = createGeneratedDraftRevision({
    template_key: 'agent-community-expert',
    storefront_blocks: blocks,
    brand_kit: {
      logo_dark_url: 'https://cdn.example.com/dark.svg',
      cover_url: 'https://cdn.example.com/cover.jpg',
      page_background: '#f8f7fc',
      font: 'Manrope',
      button_shape: 'pill',
      essentials: { service_area: 'Downtown' },
      show_chatbot: false,
    },
  }, {
    profile_photo_url: 'https://cdn.example.com/profile.jpg',
    primary_color: '#17152b',
  });

  assert.equal(revision.blocks.length, 14);
  assert.deepEqual(revision.blocks.map((block) => block.type), [
    'hero', 'featured-listings', 'role-details', 'about', 'services', 'expertise',
    'seller-performance', 'seller-sold-results', 'seller-case-study', 'seller-credentials',
    'testimonials', 'guidance', 'cta', 'footer',
  ]);
  assert.equal(revision.brandKit.profile_photo_url, 'https://cdn.example.com/profile.jpg');
  assert.equal(revision.brandKit.logo_dark_url, 'https://cdn.example.com/dark.svg');
  assert.equal(revision.brandKit.cover_url, 'https://cdn.example.com/cover.jpg');
  assert.equal(revision.brandKit.page_background, '#f8f7fc');
  assert.equal(revision.brandKit.font_family, 'Manrope');
  assert.equal(revision.brandKit.show_chatbot, false);
  assert.equal(
    validateStorefrontDraftForRole({
      blocks: revision.blocks,
      brandKit: revision.brandKit,
      template: revision.template,
    }, 'agent').error,
    undefined,
  );
});

test('owner preview serializers expose public feedback and community profile inputs', () => {
  const profile = {
    testimonials: [{ client_name: 'Older', rating: 4, text: 'Great', date: '2026-01-01' }],
    feedback_submissions: [{
      _id: 'feedback-1',
      client_name: 'Recent',
      rating: 5,
      text: 'Excellent',
      submitted_at: '2026-02-01',
    }],
  };
  const summary = toProfessionalProfileSummary({
    calendly_link: 'https://calendly.com/example',
    service_area_primary_zones: ['Downtown'],
    service_area_secondary_zones: ['West End'],
    service_area_cities: ['Toronto'],
    service_area_regions: ['GTA'],
    languages_spoken: ['english', 'urdu'],
    core_specialization_tags: ['relocation'],
  });

  assert.equal(serializeProfileFeedback(profile)[0].rating, 5);
  assert.equal(mergeProfileTestimonials(profile)[0].client_name, 'Recent');
  assert.equal(summary.calendly_link, 'https://calendly.com/example');
  assert.deepEqual(summary.service_area_primary_zones, ['Downtown']);
  assert.deepEqual(summary.languages_spoken, ['english', 'urdu']);
  assert.deepEqual(summary.core_specialization_tags, ['relocation']);
});

test('storefront block types are constrained by professional role', () => {
  assert.deepEqual(
    allowedStorefrontBlockTypes('mortgage_broker'),
    [
      'hero', 'expertise', 'role-details', 'about', 'testimonials', 'services', 'guidance', 'cta', 'footer',
      'mortgage-calculator', 'mortgage-programs',
    ],
  );

  const brokerDraft = validateStorefrontDraftForRole({
    blocks: [{ id: 'calculator', type: 'mortgage-calculator', data: { content: {} } }],
  }, 'mortgage_broker');
  assert.equal(brokerDraft.error, undefined);

  const agentOnlyBlock = validateStorefrontDraftForRole({
    blocks: [{ id: 'properties', type: 'properties', data: { content: {} } }],
  }, 'lawyer');
  assert.match(agentOnlyBlock.error.message, /Unsupported storefront block type/);

  const removedValuationBlock = validateStorefrontDraftForRole({
    blocks: [{ id: 'valuation', type: 'home-valuation', data: { content: {} } }],
  }, 'agent');
  assert.match(removedValuationBlock.error.message, /Unsupported storefront block type/);

  const sharedProofBlocks = [
    { id: 'performance', type: 'seller-performance', data: { content: {} } },
    { id: 'sold-results', type: 'seller-sold-results', data: { content: {} } },
    { id: 'case-study', type: 'seller-case-study', data: { content: {} } },
    { id: 'seller-credentials', type: 'seller-credentials', data: { content: {} } },
  ];
  [
    'agent-seller-expert',
    'agent-luxury-advisor',
    'agent-first-home',
    'agent-community-expert',
  ].forEach((templateId) => {
    const sellerProofDraft = validateStorefrontDraftForRole({
      template: { id: templateId },
      blocks: sharedProofBlocks,
    }, 'agent');
    assert.equal(sellerProofDraft.error, undefined, `${templateId} should accept shared proof blocks`);
  });

  [
    { templateId: 'agent-classic', role: 'agent' },
    { templateId: 'agent-seller-expert', role: 'mortgage_broker' },
    { templateId: 'agent-luxury-advisor', role: 'lawyer' },
  ].forEach(({ templateId, role }) => {
    const sellerProofDraft = validateStorefrontDraftForRole({
      template: { id: templateId },
      blocks: sharedProofBlocks,
    }, role);
    assert.match(
      sellerProofDraft.error.message,
      /Unsupported storefront block type/,
      `${role} using ${templateId} should reject shared proof blocks`,
    );
  });
});

test('storefront data rejects unsafe content and malformed layout or style', () => {
  const invalidUrl = saveStorefrontDraftSchema.validate({
    draft: {
      blocks: [{ id: 'hero', type: 'hero', data: { content: { image_url: 'javascript:alert(1)' } } }],
    },
  });
  assert.ok(invalidUrl.error);

  const invalidStyle = saveStorefrontDraftSchema.validate({
    draft: {
      blocks: [{
        id: 'hero',
        type: 'hero',
        data: {
          content: { body: 'x'.repeat(2001) },
          layout: { alignment: 'diagonal' },
          style: { textColor: 'red' },
        },
      }],
    },
  });
  assert.ok(invalidStyle.error);
});

test('publishing snapshots a draft and public serialization exposes no draft', () => {
  const draft = createDraftRevision({
    blocks: [{ id: 'hero', type: 'hero', data: { title: 'Before publish' } }],
    brandKit: { primary_color: '#112233' },
    template: { id: 'modern' },
  }, new Date('2026-01-01T00:00:00.000Z'));
  const published = createPublishedRevision(draft, new Date('2026-01-02T00:00:00.000Z'));

  draft.blocks[0].data.title = 'Unpublished edit';
  const publicStorefront = serializePublishedStorefront({ draft, published });

  assert.equal(publicStorefront.blocks[0].data.title, 'Before publish');
  assert.equal(publicStorefront.published_at, '2026-01-02T00:00:00.000Z');
  assert.equal('draft' in publicStorefront, false);
});
