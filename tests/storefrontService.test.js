import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraftRevision,
  createPublishedRevision,
  serializePublishedStorefront,
  serializeStorefrontDrafts,
  storefrontDrafts,
} from '../services/publicProfile/storefrontService.js';
import { saveStorefrontDraftSchema } from '../schemas/publicProfileSchemas.js';
import {
  allowedStorefrontBlockTypes,
  validateStorefrontDraftForRole,
} from '../services/publicProfile/storefrontValidation.js';

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

test('storefront draft validation rejects duplicate blocks and unknown metadata', () => {
  const duplicate = saveStorefrontDraftSchema.validate({
    draft: {
      blocks: [
        { id: 'hero', type: 'hero' },
        { id: 'hero', type: 'services' },
      ],
    },
  });
  assert.ok(duplicate.error);

  const unknownBrandKit = saveStorefrontDraftSchema.validate({
    draft: { brandKit: { primary_color: '#112233', unexpected: 'value' } },
  });
  assert.ok(unknownBrandKit.error);
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
