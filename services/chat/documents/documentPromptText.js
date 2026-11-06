import mongoose from 'mongoose';
import OpenAI from 'openai';
import LeadDocument from '../../../models/LeadDocument.js';

const PROMPT_CHAR_CAP = 6500;
const PASSAGE_CHARS = 1200;
const PASSAGE_BUDGET = 3600;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'about', 'tell', 'document', 'file',
  'please', 'does', 'have', 'there', 'they', 'their', 'your', 'you', 'can', 'are', 'was', 'were', 'which',
]);

export function hasReadableDocumentText(doc) {
  const text = String(doc?.extracted_text || '').replace(/\s+/g, ' ').trim();
  return text.replace(/[^A-Za-z0-9]/g, '').length >= 20;
}

export function textIsKnown(doc) {
  return doc?.status === 'ready' || doc?.status === 'failed';
}

function contentWords(value) {
  return [...new Set(String(value || '').toLowerCase().match(/[a-z][a-z0-9'-]{4,}/g) || [])]
    .filter((word) => !STOP_WORDS.has(word));
}

function summaryIsGrounded(summary, text) {
  const words = contentWords(summary);
  const source = String(text || '').toLowerCase();
  if (words.length < 2 || source.length < 20) return false;
  const hits = words.filter((word) => source.includes(word));
  return hits.length >= 2 && hits.length / words.length >= 0.34;
}

export function documentReadReply(documents = []) {
  const rows = Array.isArray(documents) ? documents : [];
  if (!rows.length) return '';
  if (rows.some((doc) => !textIsKnown(doc))) {
    return rows.some((doc) => doc.kind === 'image')
      ? 'I have the photo. I am still looking at it, so I will not guess what it shows.'
      : 'I have the file. I am still reading it, so I will not guess what it says.';
  }
  if (rows.every((doc) => doc.kind === 'image') && rows.every((doc) => !hasReadableDocumentText(doc))) {
    return 'I have the photo, but I could not make out what it shows. Please send it once more.';
  }
  if (rows.every((doc) => doc.status === 'failed' || !hasReadableDocumentText(doc))) {
    return 'This file has no readable text. It looks blank, so I cannot tell you what it says.';
  }
  return '';
}

function questionTerms(question) {
  return [...new Set(String(question || '').toLowerCase().match(/[a-z0-9$][a-z0-9$.,-]*/g) || [])]
    .map((term) => term.replace(/[.,-]+$/, ''))
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function splitPassages(text) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const passages = [];
  for (let start = 0; start < source.length; start += PASSAGE_CHARS) {
    passages.push({ index: passages.length, text: source.slice(start, start + PASSAGE_CHARS) });
  }
  return passages;
}

export function relevantDocumentPassages(text, question = '', budget = PASSAGE_BUDGET) {
  const passages = splitPassages(text);
  if (!passages.length) return { excerpt: '', partial: false };
  const full = passages.map((passage) => passage.text).join(' ');
  if (full.length <= budget) return { excerpt: full, partial: false };
  const terms = questionTerms(question);
  const scored = passages.map((passage) => {
    const lower = passage.text.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    return { ...passage, score };
  });
  const chosen = new Set([0]);
  scored
    .filter((passage) => passage.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .forEach((passage) => {
      if ((chosen.size + 1) * PASSAGE_CHARS <= budget) chosen.add(passage.index);
    });
  for (let index = 1; chosen.size * PASSAGE_CHARS < budget && index < passages.length; index += 1) {
    if (!terms.length) chosen.add(index);
    else break;
  }
  const excerpt = [...chosen]
    .sort((a, b) => a - b)
    .map((index) => passages[index].text)
    .join('\n[...]\n');
  return { excerpt, partial: true };
}

function describeDocumentForPrompt(doc, { label, question, includeText }) {
  if (doc.kind === 'image' && hasReadableDocumentText(doc)) {
    const description = String(doc.extracted_text || doc.summary || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    return [
      `- ${label} (photo${doc.original_filename ? `, ${doc.original_filename}` : ''}): ${description}`,
      'Use this only to decide whether the photo is the requested document. Do not describe the picture to the visitor.',
    ];
  }
  if (doc.kind === 'image') {
    return [`- ${label}: photo saved, description not ready. Say you are still looking at it. Do not invent what it shows.`];
  }
  if (doc.status === 'failed') return [`- ${label}: saved, but the text could not be read. Say that plainly. Do not describe the file.`];
  if (!textIsKnown(doc)) return [`- ${label}: still being read. Say you have it and will look in a moment. Do not describe the file.`];
  if (!hasReadableDocumentText(doc)) return [`- ${label}: no readable text. Say the file looks blank. Do not describe it.`];
  const lines = [];
  const facts = (doc.key_facts || []).slice(0, 6).join('; ');
  const summary = summaryIsGrounded(doc.summary, doc.extracted_text) ? String(doc.summary || '').slice(0, 500) : '';
  const kind = doc.document_type || doc.kind || 'file';
  lines.push(`- ${label} (${kind})${summary ? `: ${summary}` : ''}${facts ? ` Facts: ${facts}.` : ''}`);
  if (includeText) {
    const { excerpt, partial } = relevantDocumentPassages(doc.extracted_text, question);
    if (excerpt) {
      lines.push(partial
        ? `This file is long. These are the parts that matter for the question, in page order:\n${excerpt}`
        : `Full text of this file:\n${excerpt}`);
    }
  }
  return lines;
}

export function buildSharedDocumentsPrompt(documents = [], options = {}) {
  const rows = (Array.isArray(documents) ? documents : []).slice(-4);
  if (!rows.length) return '';
  const focus = new Set((options.focusIds || []).map(String).filter(Boolean));
  const focused = focus.size
    ? rows.filter((doc) => focus.has(String(doc._id || doc.id)))
    : [];
  const source = focused.length ? focused : (focus.size ? rows.slice(-1) : rows);
  const photo = source.some((doc) => doc.kind === 'image');
  const lines = [
    photo ? 'Photos the visitor shared:' : 'Documents the visitor shared:',
    photo
      ? 'The visitor shared a photo. Say only whether it is the requested document or a different file. Do not describe the picture. Do not invent names, prices, or text that is not written below.'
      : (focus.size
        ? 'The visitor just uploaded a new file. Answer about that file only. Do not repeat an earlier file or your previous reply. Do not guess.'
        : 'Answer only from the text below. Do not guess the subject, the property, the price, the parties, or market trends.'),
    photo
      ? 'Answer the visitor in plain language about that photo.'
      : 'If the text does not answer the question, say so plainly. For a long file, give the main points first, then answer the question. Do not claim approval or give a legal or financial ruling.',
  ];
  source.forEach((doc, index) => {
    const newest = index === source.length - 1;
    const label = focus.size ? 'New file' : (newest ? 'Latest file' : `Earlier file ${index + 1}`);
    lines.push(...describeDocumentForPrompt(doc, { label, question: options.question, includeText: newest }));
  });
  return lines.join('\n').slice(0, PROMPT_CHAR_CAP);
}

async function waitForDocumentFields(ids = [], timeoutMs = 20000, ready) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  if (!wanted.length) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const docs = await LeadDocument.find({ _id: { $in: wanted } }).select('status text_ready').lean();
    if (docs.length === wanted.length && docs.every(ready)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function waitForDocumentReads(ids = [], timeoutMs = 20000) {
  await waitForDocumentFields(ids, timeoutMs, textIsKnown);
}

export async function waitForDocumentSummaries(ids = [], timeoutMs = 8000) {
  await waitForDocumentFields(ids, timeoutMs, (doc) => doc?.status === 'ready' || doc?.status === 'failed');
}

export async function briefDocumentAnswer(documents = [], question = '') {
  const rows = Array.isArray(documents) ? documents : [];
  const doc = rows[rows.length - 1];
  const text = String(doc?.extracted_text || '').replace(/\s+/g, ' ').trim();
  const summary = String(doc?.summary || '').replace(/\s+/g, ' ').trim();
  const { excerpt } = relevantDocumentPassages(text, question, 5000);
  const notes = [
    summaryIsGrounded(summary, text) ? summary : '',
    excerpt,
  ].filter(Boolean).join('\n').slice(0, 5200);
  if (!doc || notes.length < 40 || !process.env.OPENAI_API_KEY) return '';
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const photo = doc.kind === 'image';
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 160,
    messages: [{
      role: 'user',
      content: `${photo
        ? 'Do not describe the photo. Say only whether it is the requested document or a different file, in one or two short sentences.'
        : 'Answer in two or three short sentences using only the notes. Do not add a topic, property, price, or person that is not written in the notes. Do not give a legal or lending ruling.'}\n\nQuestion: ${String(question || '').slice(0, 400)}\n\nNotes:\n${notes}`,
    }],
  });
  return String(completion.choices?.[0]?.message?.content || '').trim();
}
