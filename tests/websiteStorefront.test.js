import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraftRevision,
  createPublishedRevision,
  storefrontRevisionDraftForValidation,
} from '../services/publicProfile/storefrontService.js';
import { validateStorefrontDraftForRole } from '../services/publicProfile/storefrontValidation.js';

function hero(id = 'hero-home') {
  return {
    id,
    type: 'hero',
    data: {
      enabled: true,
      content: { heading: 'A local practice' },
      layout: { alignment: 'left', variant: 'editorial', mediaPosition: 'cover' },
    },
  };
}

test('website drafts keep pages on the published revision without changing the homepage blocks', () => {
  const home = hero();
  const about = hero('hero-about');
  const draft = {
    blocks: [home],
    template: { id: 'agent-atelier', name: 'Premium Real Estate Agent', version: '2' },
    brandKit: { primary_color: '#1C1917', font_family: 'Playfair Display' },
    website: {
      name: 'Premium Real Estate Agent',
      active_page_id: 'home',
      pages: [
        {
          id: 'home',
          name: 'Home',
          slug: 'home',
          type: 'home',
          status: 'published',
          blocks: [home],
        },
        {
          id: 'about',
          name: 'About',
          slug: 'about',
          type: 'about',
          status: 'published',
          blocks: [about],
          form: {
            intent: 'consultation',
            submit_label: 'Schedule a consultation',
            success_message: 'Your request has been sent.',
            fields: [
              { key: 'full_name', label: 'Full name', type: 'text', required: true },
              { key: 'email', label: 'Email', type: 'email', required: true },
            ],
          },
        },
      ],
      navigation: {
        header: [
          {
            id: 'nav-home',
            label: 'Home',
            kind: 'page',
            page_id: 'home',
            href: '',
            visible: true,
            children: [],
          },
          {
            id: 'nav-group',
            label: 'Practice',
            kind: 'page',
            page_id: 'about',
            href: '',
            visible: true,
            children: [{
              id: 'nav-about',
              label: 'About',
              kind: 'page',
              page_id: 'about',
              href: '',
              visible: true,
            }],
          },
        ],
        footer: [],
      },
    },
  };

  const sourcePayload = storefrontRevisionDraftForValidation(draft);
  const result = validateStorefrontDraftForRole(sourcePayload, 'agent');
  assert.equal(result.error, undefined);
  const published = createPublishedRevision(createDraftRevision(result.value));
  assert.equal(published.blocks[0].id, 'hero-home');
  assert.equal(published.website.pages[1].blocks[0].id, 'hero-about');
  assert.equal(published.website.navigation.header[1].children[0].page_id, 'about');
  draft.blocks[0].data.content.heading = 'Unpublished edit';
  assert.equal(published.blocks[0].data.content.heading, 'A local practice');
});

test('website draft validation accepts saved header and footer presets with contact settings', () => {
  const block = hero();
  const makeDraft = (header_variant, footer_variant = 'signature') => ({
    blocks: [block],
    template: { id: 'agent-atelier', version: '2' },
    website: {
      settings: {
        header_variant,
        footer_variant,
        header_phone: '+1 555 010 1234',
        header_email: 'hello@example.com',
        header_location: 'Toronto, ON',
      },
      pages: [{
        id: 'home',
        name: 'Home',
        slug: 'home',
        type: 'home',
        blocks: [block],
      }],
    },
  });

  for (const header_variant of ['standard', 'contact_bar', 'editorial', 'modern', 'atelier']) {
    const draft = makeDraft(header_variant);
    const result = validateStorefrontDraftForRole(draft, 'agent');
    assert.equal(result.error, undefined, `Expected ${header_variant} header settings to validate`);
    assert.deepEqual(result.value.website.settings, draft.website.settings);
  }

  for (const footer_variant of ['signature', 'editorial', 'columns', 'contact', 'minimal']) {
    const draft = makeDraft('standard', footer_variant);
    const result = validateStorefrontDraftForRole(draft, 'agent');
    assert.equal(result.error, undefined, `Expected ${footer_variant} footer settings to validate`);
    assert.deepEqual(result.value.website.settings, draft.website.settings);
  }

  const contactDraft = makeDraft('contact_bar');
  const invalid = validateStorefrontDraftForRole({
    ...contactDraft,
    website: {
      ...contactDraft.website,
      settings: { ...contactDraft.website.settings, header_email: 'not-an-email' },
    },
  }, 'agent');
  assert.ok(invalid.error);
});

test('website drafts reject a nested navigation leaf that carries its own children', () => {
  const block = hero();
  const result = validateStorefrontDraftForRole({
    blocks: [block],
    template: { id: 'lawyer-counsel', version: '2' },
    website: {
      pages: [{
        id: 'home',
        name: 'Home',
        slug: 'home',
        type: 'home',
        blocks: [block],
      }],
      navigation: {
        header: [{
          id: 'nav-home',
          label: 'Home',
          kind: 'page',
          page_id: 'home',
          children: [{
            id: 'nav-child',
            label: 'Child',
            kind: 'page',
            page_id: 'home',
            children: [],
          }],
        }],
      },
    },
  }, 'lawyer');
  assert.ok(result.error);
});
