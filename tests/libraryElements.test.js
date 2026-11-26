import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStorefrontDraftForRole } from '../services/publicProfile/storefrontValidation.js';
import { canonicalizeLawyerInvestorDraft } from '../services/publicProfile/lawyerInvestorStorefrontContract.js';
import { canonicalizeLawyerNewcomerDraft } from '../services/publicProfile/lawyerNewcomerStorefrontContract.js';

const element = {
  id: 'ui-element-1',
  type: 'ui-element',
  data: {
    enabled: true,
    content: {
      element_key: 'heading',
      variant: 'editorial',
      category: 'typography',
      theme_linked: true,
      heading: 'A kept headline',
      appearance: { text_color: '', disabled: false },
    },
    layout: { alignment: 'left', padding: 'medium', width: 'contained', columns: '1' },
    style: { background: '', textColor: '', radius: 'default', shadow: 'none' },
  },
};

test('ui-element is accepted on a template with a closed block allow-list', () => {
  const result = validateStorefrontDraftForRole({
    template: { id: 'mortgage_broker-classic' },
    blocks: [
      { id: 'hero', type: 'hero', data: { content: {} } },
      element,
      { id: 'footer', type: 'footer', data: { content: {} } },
    ],
  }, 'mortgage_broker');
  assert.equal(result.error, undefined);
});

test('lawyer investor canonicalization keeps a library element between sections', () => {
  const result = canonicalizeLawyerInvestorDraft({
    template: { id: 'lawyer-investor', version: '11' },
    blocks: [
      { id: 'hero', type: 'hero', data: { content: { investor_design_version: 11 } } },
      element,
      { id: 'about', type: 'about', data: { content: {} } },
      { id: 'footer', type: 'footer', data: { content: {} } },
    ],
  });
  assert.deepEqual(result.blocks.map((block) => block.type), ['hero', 'ui-element', 'about', 'footer']);
  assert.equal(result.blocks[1].data.content.heading, 'A kept headline');
});

test('lawyer newcomer canonicalization keeps a library element', () => {
  const result = canonicalizeLawyerNewcomerDraft({
    template: { id: 'lawyer-newcomer', version: '6' },
    blocks: [
      { id: 'hero', type: 'hero', data: { content: { newcomer_design_version: 6 } } },
      element,
      { id: 'footer', type: 'footer', data: { content: {} } },
    ],
  });
  assert.equal(result.blocks.some((block) => block.id === 'ui-element-1'), true);
  assert.equal(result.blocks.find((block) => block.id === 'ui-element-1').data.content.heading, 'A kept headline');
});
