import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSharedDocumentsPrompt,
  applyDocumentAsk,
  assertChatDocumentLimits,
  countDocumentPages,
  documentReadReply,
  documentRequestIds,
  leadDocumentLinkFilter,
  nextDocumentRequest,
  requestDocumentForReply,
  sniffChatFile,
} from '../services/chat/documents/chatDocumentService.js';
import { buildPreviewChatPrompt, sanitizeAssistant } from '../services/professionalAssistant/professionalAssistantService.js';

test('chat uploads accept pdf, docx, and images and reject other bytes', () => {
  assert.equal(sniffChatFile(Buffer.from('%PDF-1.4\n'), 'application/pdf').kind, 'pdf');
  assert.equal(sniffChatFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'image/jpeg').kind, 'image');
  const heix = Buffer.alloc(16);
  heix.write('ftyp', 4, 'latin1');
  heix.write('heix', 8, 'latin1');
  assert.equal(sniffChatFile(heix, 'image/heic', 'photo.heic').kind, 'image');
  assert.equal(sniffChatFile(Buffer.from('GIF89a\x00\x00'), 'image/gif', 'anim.gif').ok, false);
  const docx = Buffer.concat([Buffer.from('PK'), Buffer.alloc(20)]);
  assert.equal(sniffChatFile(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').kind, 'word');
  assert.equal(sniffChatFile(docx, 'application/octet-stream', 'agreement.docx').kind, 'word');
  assert.equal(sniffChatFile(docx, 'application/octet-stream', 'notes.zip').ok, false);
  assert.equal(sniffChatFile(Buffer.from('hello world this is text'), 'text/plain').ok, false);
  assert.equal(sniffChatFile(Buffer.from('MZ'), 'application/pdf').ok, false);
});

test('shared document prompt stays short and says a file is still being read', () => {
  const prompt = buildSharedDocumentsPrompt([
    { original_filename: 'paystub.pdf', status: 'reading' },
    { original_filename: 'agreement.pdf', status: 'ready', kind: 'pdf', document_type: 'purchase agreement', summary: 'A purchase agreement.', extracted_text: 'This purchase agreement closes on May 2.', key_facts: ['Closing May 2'] },
  ]);
  assert.match(prompt, /still being read/);
  assert.match(prompt, /Do not guess/);
  assert.match(prompt, /purchase agreement/);
  assert.ok(prompt.length <= 2500);
});

function storedZip(name, content) {
  const data = Buffer.from(content);
  const entryName = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt16LE(entryName.length, 26);
  return Buffer.concat([header, entryName, data]);
}

test('the reply context uses the file text and drops a summary that is not in the file', () => {
  const receipt = {
    _id: 'receipt',
    status: 'ready',
    kind: 'pdf',
    document_type: 'receipt',
    summary: 'This document is a receipt for a payment made for the Cursor Pro Plus service, covering September 7, 2026 to September 7, 2027.',
    extracted_text: 'Receipt 2389. Cursor Pro Plus. September 7, 2026.',
  };
  const receiptPrompt = buildSharedDocumentsPrompt([receipt], { focusIds: ['receipt'], question: 'what is this about?' });
  assert.match(receiptPrompt, /Cursor Pro Plus/);
  const plan = {
    _id: 'plan',
    status: 'ready',
    kind: 'pdf',
    summary: 'This document offers key details for visitors about property listings, including features, pricing, and neighborhood insights.',
    extracted_text: 'This document provides a comprehensive analysis of client requirements for the Nesti platform transformation.',
  };
  const planPrompt = buildSharedDocumentsPrompt([plan], { focusIds: ['plan'], question: 'what is this about?' });
  assert.match(planPrompt, /Nesti platform/);
  assert.doesNotMatch(planPrompt, /property listings/);
});

test('an agreement is limited to 10 pages and 10 MB', async () => {
  const short = storedZip('word/document.xml', '<w:document><w:t>Purchase agreement for one property.</w:t></w:document>');
  assert.equal(await countDocumentPages(short, 'word'), 1);
  await assertChatDocumentLimits(short, 'word');
  const long = storedZip('word/document.xml', `<w:document>${'<w:lastRenderedPageBreak/>'.repeat(10)}<w:t>Agreement</w:t></w:document>`);
  assert.equal(await countDocumentPages(long, 'word'), 11);
  await assert.rejects(assertChatDocumentLimits(long, 'word'), /11 pages/);
  const heavy = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);
  heavy.write('%PDF-1.4\n', 0);
  await assert.rejects(assertChatDocumentLimits(heavy, 'pdf'), /10 MB/);
});

test('a blank file is not described', () => {
  const blank = { _id: 'blank', original_filename: 'Proof.pdf', status: 'ready', summary: 'Property listings and market trends.', extracted_text: ' ' };
  assert.match(documentReadReply([blank]), /no readable text/);
  assert.equal(documentReadReply([{ ...blank, extracted_text: 'Employer Acme Homes paid 2400.' }]), '');
  const prompt = buildSharedDocumentsPrompt([blank], { focusIds: ['blank'] });
  assert.match(prompt, /looks blank/);
  assert.doesNotMatch(prompt, /market trends/);
});

test('a newly uploaded file is answered without the previous file', () => {
  const prompt = buildSharedDocumentsPrompt([
    { _id: 'a', original_filename: 'receipt.pdf', status: 'ready', summary: 'Cursor Pro Plus $583.09', extracted_text: 'Payment by Ravinna Raveenthiran' },
    { _id: 'b', original_filename: 'cv.pdf', status: 'ready', summary: 'CV for Nabeel', extracted_text: 'Nabeel Faheem software engineer' },
  ], { focusIds: ['b'] });
  assert.match(prompt, /Nabeel Faheem/);
  assert.match(prompt, /that file only/);
  assert.doesNotMatch(prompt, /Ravinna/);
  assert.doesNotMatch(prompt, /583\.09/);
});

test('a photo description is given to the reply', () => {
  const prompt = buildSharedDocumentsPrompt([
    {
      _id: 'pic',
      kind: 'image',
      status: 'ready',
      text_ready: true,
      original_filename: '4.JPG',
      document_type: 'photo',
      summary: 'A person in a black coat.',
      extracted_text: 'A person wearing a black coat and a necklace stands in front of a pale wall.',
    },
  ], { focusIds: ['pic'], question: 'tell me about this image' });
  assert.match(prompt, /black coat/);
  assert.match(prompt, /Describe this photo/);
  assert.match(prompt, /Do not say you cannot see the image/);
  assert.doesNotMatch(prompt, /looks blank/);
});

test('the newest document text is included for the reply', () => {
  const prompt = buildSharedDocumentsPrompt([
    { original_filename: 'notes.pdf', status: 'ready', document_type: 'pay stub', summary: 'Pay from Acme.', extracted_text: 'Gross pay 2400. Employer Acme Homes.', key_facts: ['Gross pay 2400'] },
  ]);
  assert.match(prompt, /Gross pay 2400/);
  assert.match(prompt, /Employer Acme Homes/);
});

test('preview documents are not linked and saved documents are', () => {
  const filter = leadDocumentLinkFilter({ userId: 'pro', conversationId: 'convo', sessionId: 'sess' });
  assert.deepEqual(filter.preview, { $ne: true });
  assert.equal(filter.lead_match_id, null);
  assert.equal(filter.user_id, 'pro');
});

test('document requests are sanitized and reach the broker prompt', () => {
  const setting = sanitizeAssistant({
    applied: true,
    document_requests: ['pay_stubs', 'not-a-document', 'photo_id'],
  }, 'mortgage_broker');
  assert.deepEqual(setting.document_requests, ['pay_stubs', 'photo_id']);
  const prompt = buildPreviewChatPrompt('mortgage_broker', { full_name: 'Sam Broker' }, { assistantSetting: setting });
  assert.match(prompt, /Recent pay stubs/);
  assert.match(prompt, /Photo ID/);
  assert.equal(nextDocumentRequest(setting, []).label, 'Recent pay stubs');
  assert.equal(nextDocumentRequest(setting, [{ document_type: 'Recent pay stubs', original_filename: 'pay.pdf' }]).id, 'photo_id');
  assert.equal(nextDocumentRequest(setting, [{ document_type: 'Photos of the home', original_filename: 'kitchen.jpg' }]).id, 'pay_stubs');
  assert.equal(requestDocumentForReply(nextDocumentRequest(setting, []), 'Hello. Is this a new mortgage or a refinance?'), null);
  assert.equal(requestDocumentForReply(nextDocumentRequest(setting, []), 'Could you upload a recent pay stub?').id, 'pay_stubs');
  assert.equal(requestDocumentForReply({ id: 'pay_stubs', label: 'Recent pay stubs' }, 'I can help with the payment.'), null);
  assert.equal(requestDocumentForReply({ id: 'photo_id', label: 'Photo ID' }, 'A photo of the kitchen.'), null);
  assert.equal(nextDocumentRequest({ role: 'lawyer', document_requests: [] }, []), null);
  assert.equal(nextDocumentRequest({ role: 'agent', document_requests: ['preapproval_letter', 'home_photos'] }, [], 'sell').id, 'home_photos');
  assert.equal(nextDocumentRequest({ role: 'mortgage_broker', document_requests: ['pay_stubs', 'mortgage_statement'] }, [], { text: 'this is a renewal' }).id, 'mortgage_statement');
  assert.equal(documentRequestIds({ role: 'lawyer', document_requests: ['purchase_agreement', 'condo_status'] }, { text: 'detached house' }).includes('condo_status'), false);
  assert.equal(documentRequestIds({ role: 'lawyer', document_requests: ['purchase_agreement', 'condo_status'] }, { text: 'a condo purchase' }).includes('condo_status'), true);
  assert.equal(nextDocumentRequest(setting, [{ original_filename: 'paystubs.pdf', summary: '' }]).id, 'photo_id');
  const asked = applyDocumentAsk('I can look at the file.', nextDocumentRequest(setting, []), {
    userMessage: 'I need a mortgage',
    setting,
  });
  assert.match(asked.reply, /recent pay stubs/i);
  assert.equal(asked.request.id, 'pay_stubs');
  assert.equal(applyDocumentAsk('Hello.', nextDocumentRequest(setting, []), { userMessage: 'hi', setting }).request, null);
  assert.equal(applyDocumentAsk('Is this a new mortgage or a refinance?', nextDocumentRequest(setting, []), {
    userMessage: 'I need help',
    setting,
  }).request, null);
  const french = applyDocumentAsk('Je peux regarder le dossier.', nextDocumentRequest(setting, []), {
    userMessage: 'je veux un prêt',
    setting: { ...setting, languages: ['french'] },
  });
  assert.match(french.reply, /talons de paie/);
  const repeat = applyDocumentAsk('What is the timeline?', asked.request, { previousReply: asked.reply, userMessage: 'next month', setting });
  assert.equal(repeat.reply, 'What is the timeline?');
  assert.equal(repeat.request.id, 'pay_stubs');
  const agent = sanitizeAssistant({
    applied: true,
    document_requests: ['preapproval_letter', 'home_photos'],
  }, 'agent');
  const opening = applyDocumentAsk('Are you looking to buy or sell a home? You can upload your pre-approval letter here.', nextDocumentRequest(agent, []), {
    userMessage: 'yes',
    setting: agent,
  });
  assert.equal(opening.request, null);
  assert.doesNotMatch(opening.reply, /upload/i);
  const selling = applyDocumentAsk('Can you share some details about the property you are selling? You can upload your photos of the home here.', nextDocumentRequest(agent, [], 'sell'), {
    userMessage: 'am looking to sell',
    previousReply: 'Are you looking to buy or sell a home?',
    setting: agent,
  });
  assert.equal(selling.request, null);
  assert.doesNotMatch(selling.reply, /upload/i);
  const ready = applyDocumentAsk('What timeline are you hoping for?', nextDocumentRequest(agent, [], 'sell'), {
    userMessage: 'It is a 3 bedroom in Toronto',
    previousReply: 'Can you share some details about the property you are selling?',
    setting: agent,
  });
  assert.match(ready.reply, /photos of the home/i);
  assert.equal(ready.request.id, 'home_photos');
  const paused = applyDocumentAsk('That works. Please upload the recent pay stubs here.', nextDocumentRequest(setting, []), {
    userMessage: 'i will upload documents later',
    setting,
  });
  assert.equal(paused.request, null);
  assert.doesNotMatch(paused.reply, /upload/i);
});
