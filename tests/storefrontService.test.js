import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraftRevision,
  createPublishedRevision,
  serializePublishedStorefront,
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
          layout: { alignment: 'center', padding: 'large', width: 'contained', hiddenOn: ['mobile'] },
          style: { background: '#112233', textColor: '#ffffff', radius: 'large', shadow: 'medium' },
        },
      }],
      brandKit: { primary_color: '#112233' },
      template: { id: 'modern', version: '1' },
    },
  });

  assert.equal(error, undefined);
  assert.equal(value.draft.blocks[0].data.content.heading, 'A business');
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
      'hero', 'expertise', 'role-details', 'about', 'testimonials', 'services', 'guidance', 'cta',
      'mortgage-calculator', 'mortgage-programs',
    ],
  );

  const brokerDraft = validateStorefrontDraftForRole({
    blocks: [{ id: 'calculator', type: 'mortgage-calculator', data: { content: {} } }],
  }, 'mortgage_broker');
  assert.equal(brokerDraft.error, undefined);

  const agentOnlyBlock = validateStorefrontDraftForRole({
    blocks: [{ id: 'valuation', type: 'home-valuation', data: { content: {} } }],
  }, 'lawyer');
  assert.match(agentOnlyBlock.error.message, /Unsupported storefront block type/);
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
