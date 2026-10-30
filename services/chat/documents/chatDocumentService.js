import crypto from 'node:crypto';
import zlib from 'node:zlib';
import mammoth from 'mammoth';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
import LeadDocument from '../../../models/LeadDocument.js';
import LeadMatch from '../../../models/LeadMatch.js';
import { DOCUMENT_REQUESTS, idsOf, labelOf } from '../../professionalAssistant/catalog.js';
import { isGreetingOnly, isVagueYes, normalizedVisitorText } from '../../professionalAssistant/visitorMessage.js';
import { replyLanguage } from '../../professionalAssistant/replyStyle.js';
import { visitorPausesDetails } from '../utils/chatBookingReply.js';
import { createSignedReadUrl, deleteObjectFromR2, getObjectFromR2, uploadBufferToR2 } from '../../media/r2Client.js';
import logger from '../../../utils/logger.js';
import { MAX_CHATBOT_ATTACHMENT_BYTES } from '../../../middleware/uploadChatbotAttachment.js';

export const MAX_DOCUMENT_PAGES = 10;

const MAX_FILES_PER_CONVERSATION = 10;
const MAX_EXTRACTED_CHARS = 120000;
const PROMPT_CHAR_CAP = 6500;
const PASSAGE_CHARS = 1200;
const PASSAGE_BUDGET = 3600;
const SUMMARY_CHUNK_CHARS = 8000;
const SUMMARY_MAX_CHUNKS = 8;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'about', 'tell', 'document', 'file',
  'please', 'does', 'have', 'there', 'they', 'their', 'your', 'you', 'can', 'are', 'was', 'were', 'which',
]);

const MIME_BY_KIND = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

function ascii(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('latin1');
}

export function sniffChatFile(buffer, declaredMime = '', filename = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  const mime = String(declaredMime || '').toLowerCase();
  const name = String(filename || '').toLowerCase();
  if (bytes.length < 8) return { ok: false, reason: 'The file is empty or too small.' };
  if (ascii(bytes, 0, 5) === '%PDF-') return { ok: true, kind: 'pdf', mime: MIME_BY_KIND.pdf };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ok: true, kind: 'image', mime: MIME_BY_KIND.jpg };
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return { ok: true, kind: 'image', mime: MIME_BY_KIND.png };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { ok: true, kind: 'image', mime: MIME_BY_KIND.webp };
  const heifBrand = ascii(bytes, 8, 4);
  const namedHeif = mime.includes('heic') || mime.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif');
  if (ascii(bytes, 4, 4) === 'ftyp' && (/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/i.test(heifBrand) || namedHeif)) {
    return { ok: true, kind: 'image', mime: MIME_BY_KIND.heic };
  }
  if (ascii(bytes, 0, 2) === 'PK' && (mime.includes('wordprocessingml') || name.endsWith('.docx'))) {
    return { ok: true, kind: 'word', mime: MIME_BY_KIND.docx };
  }
  if (ascii(bytes, 0, 8) === '\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1' && (mime === MIME_BY_KIND.doc || name.endsWith('.doc'))) {
    return { ok: true, kind: 'word', mime: MIME_BY_KIND.doc };
  }
  return { ok: false, reason: 'Upload a PDF, Word document, or image.' };
}

export function hasReadableDocumentText(doc) {
  const text = String(doc?.extracted_text || '').replace(/\s+/g, ' ').trim();
  return text.replace(/[^A-Za-z0-9]/g, '').length >= 20;
}

function textIsKnown(doc) {
  return doc?.text_ready === true || doc?.status === 'ready' || doc?.status === 'failed';
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

const DOCUMENT_RECEIVED = {
  pay_stubs: /pay\s*stubs?|paystubs?|payslips?/i,
  notice_of_assessment: /notice of assessment|\bt4\b|\bnoa\b/i,
  mortgage_statement: /mortgage statement/i,
  preapproval_letter: /pre-?approval/i,
  photo_id: /photo id|passport|driver'?s licen[cs]e|government id|photo identification/i,
  home_photos: /photos? of the home|home photos|property photos/i,
  listing_sheet: /listing sheet|\bmls\b/i,
  purchase_agreement: /purchase agreement|sale agreement|agreement of purchase/i,
  title_deed: /title deed|certificate of title|\bdeed\b/i,
  mortgage_commitment: /mortgage commitment/i,
  condo_status: /status certificate|condo status/i,
};

function documentCoversRequest(doc, id) {
  const text = `${doc?.original_filename || ''} ${doc?.document_type || ''} ${doc?.summary || ''} ${(doc?.key_facts || []).join(' ')} ${String(doc?.extracted_text || '').slice(0, 3000)}`;
  if (DOCUMENT_RECEIVED[id]?.test(text)) return true;
  const folded = text.toLowerCase();
  return Object.values(DOCUMENT_NAMES).some((pack) => {
    const name = String(pack?.[id] || '').toLowerCase().replace(/^(recent|current)\s+/, '').trim();
    return name.length >= 2 && folded.includes(name);
  });
}

function requestContext(intentOrContext) {
  if (typeof intentOrContext === 'string') return { intent: intentOrContext, text: '' };
  return { intent: String(intentOrContext?.intent || ''), text: String(intentOrContext?.text || '') };
}

function orderedRequestIds(role, wanted, context) {
  const text = `${context.intent} ${context.text}`;
  const condo = /\b(condo|condominium|strata)\b/i.test(text);
  const selling = context.intent === 'sell' || /\b(sell|selling|list my|listing my home)\b/i.test(text);
  let order = wanted;
  if (role === 'agent') {
    order = selling
      ? ['home_photos', 'listing_sheet', 'preapproval_letter']
      : ['preapproval_letter', 'home_photos', 'listing_sheet'];
  } else if (role === 'mortgage_broker') {
    if (/\brenew/i.test(text)) order = ['mortgage_statement', 'photo_id', 'notice_of_assessment', 'pay_stubs', 'preapproval_letter'];
    else if (/\brefinanc/i.test(text)) order = ['mortgage_statement', 'pay_stubs', 'notice_of_assessment', 'photo_id', 'preapproval_letter'];
    else order = ['pay_stubs', 'notice_of_assessment', 'photo_id', 'preapproval_letter', 'mortgage_statement'];
  } else if (role === 'lawyer') {
    order = ['purchase_agreement', 'photo_id', 'title_deed', 'mortgage_commitment', ...(condo ? ['condo_status'] : [])];
  }
  const ranked = [...order.filter((id) => wanted.includes(id)), ...wanted.filter((id) => !order.includes(id))];
  if (role === 'lawyer' && !condo) {
    const withoutCondo = ranked.filter((id) => id !== 'condo_status');
    return withoutCondo.length ? withoutCondo : ranked;
  }
  return ranked;
}

export function documentRequestIds(setting, intentOrContext = '') {
  const catalog = DOCUMENT_REQUESTS[setting?.role] || [];
  const allowed = new Set(idsOf(catalog));
  const selected = (Array.isArray(setting?.document_requests) ? setting.document_requests : []).filter((id) => allowed.has(id));
  if (!selected.length) return [];
  return orderedRequestIds(setting?.role, selected, requestContext(intentOrContext));
}

export function nextDocumentRequest(setting, documents = [], intentOrContext = '', skipIds = []) {
  const catalog = DOCUMENT_REQUESTS[setting?.role] || [];
  const skip = new Set(skipIds);
  const missing = documentRequestIds(setting, intentOrContext).find((id) => !skip.has(id) && labelOf(catalog, id) && !(documents || []).some((doc) => documentCoversRequest(doc, id)));
  if (!missing) return null;
  return { id: missing, label: labelOf(catalog, missing) };
}

export function followUpSkipIds(setting, documents = [], intentOrContext = '', history = [], previousReply = '') {
  const catalog = DOCUMENT_REQUESTS[setting?.role] || [];
  const ids = documentRequestIds(setting, intentOrContext);
  const texts = [
    previousReply,
    ...(Array.isArray(history) ? history : []).filter((message) => message?.role === 'assistant').map((message) => message.content),
  ];
  return ids.filter((id) => {
    if ((documents || []).some((doc) => documentCoversRequest(doc, id))) return false;
    const request = { id, label: labelOf(catalog, id) };
    return texts.some((text) => requestDocumentForReply(request, text));
  });
}

function localizedDocumentName(id, language) {
  const names = DOCUMENT_NAMES[language] || DOCUMENT_NAMES.english;
  return names[id] || DOCUMENT_NAMES.english[id] || 'document';
}

const DOCUMENT_REVIEW = {
  english: {
    exactNext: (got, next) => `This is the ${got}. When you are ready, you can send the ${next} as well.`,
    exactDone: (got) => `This is the ${got}. That is all the documents I need for now.`,
    other: (got, next) => (next ? `This is the ${got}. When you are ready, you can send the ${next}.` : `This is the ${got}. We can continue with the other details.`),
    different: (next) => (next ? `This is a different file. When you are ready, you can send the ${next}.` : 'This is a different file. We can continue with the other details.'),
    received: () => 'I have the file.',
    receivedDone: () => 'I have the file. That is all the documents I need for now.',
  },
  french: {
    exactNext: (got, next) => `C'est bien ${got}. Quand vous êtes prêt, vous pouvez aussi envoyer ${next}.`,
    exactDone: (got) => `C'est bien ${got}. Ce sont tous les documents dont j'ai besoin pour le moment.`,
    other: (got, next) => (next ? `C'est bien ${got}. Quand vous êtes prêt, vous pouvez envoyer ${next}.` : `C'est bien ${got}. Nous pouvons continuer avec les autres détails.`),
    different: (next) => (next ? `C'est un autre fichier. Quand vous êtes prêt, vous pouvez envoyer ${next}.` : `C'est un autre fichier. Nous pouvons continuer avec les autres détails.`),
    received: () => `J'ai bien le fichier.`,
    receivedDone: () => `J'ai bien le fichier. Ce sont tous les documents dont j'ai besoin pour le moment.`,
  },
  spanish: {
    exactNext: (got, next) => `Este es ${got}. Cuando pueda, también puede enviar ${next}.`,
    exactDone: (got) => `Este es ${got}. Con esto tengo los documentos que necesito por ahora.`,
    other: (got, next) => (next ? `Este es ${got}. Cuando pueda, puede enviar ${next}.` : `Este es ${got}. Podemos seguir con los otros detalles.`),
    different: (next) => (next ? `Este es otro archivo. Cuando pueda, puede enviar ${next}.` : 'Este es otro archivo. Podemos seguir con los otros detalles.'),
    received: () => 'Ya tengo el archivo.',
    receivedDone: () => 'Ya tengo el archivo. Con esto tengo los documentos que necesito por ahora.',
  },
  arabic: {
    exactNext: (got, next) => `هذا هو ${got}. عندما تكون جاهزًا، يمكنك أيضًا إرسال ${next}.`,
    exactDone: (got) => `هذا هو ${got}. هذه كل المستندات التي أحتاجها الآن.`,
    other: (got, next) => (next ? `هذا هو ${got}. عندما تكون جاهزًا، يمكنك إرسال ${next}.` : `هذا هو ${got}. يمكننا المتابعة بالتفاصيل الأخرى.`),
    different: (next) => (next ? `هذا ملف مختلف. عندما تكون جاهزًا، يمكنك إرسال ${next}.` : 'هذا ملف مختلف. يمكننا المتابعة بالتفاصيل الأخرى.'),
    received: () => 'وصلتني الملف.',
    receivedDone: () => 'وصلتني الملف. هذه كل المستندات التي أحتاجها الآن.',
  },
  hindi: {
    exactNext: (got, next) => `यह ${got} है। जब आप तैयार हों, ${next} भी भेज सकते हैं।`,
    exactDone: (got) => `यह ${got} है। अभी के लिए मुझे यही दस्तावेज़ चाहिए थे।`,
    other: (got, next) => (next ? `यह ${got} है। जब आप तैयार हों, ${next} भेज सकते हैं।` : `यह ${got} है। हम बाकी बातचीत जारी रख सकते हैं।`),
    different: (next) => (next ? `यह कोई और फ़ाइल है। जब आप तैयार हों, ${next} भेज सकते हैं।` : 'यह कोई और फ़ाइल है। हम बाकी बातचीत जारी रख सकते हैं।'),
    received: () => 'फ़ाइल मिल गई।',
    receivedDone: () => 'फ़ाइल मिल गई। अभी के लिए मुझे यही दस्तावेज़ चाहिए थे।',
  },
};

export function documentReviewReply(documents = [], setting = null, context = {}) {
  const fresh = (Array.isArray(documents) ? documents : []).filter(Boolean);
  const doc = fresh[fresh.length - 1];
  if (!doc || !setting?.applied || !setting.document_requests?.length) return '';
  if (!textIsKnown(doc) && doc.status !== 'ready' && doc.status !== 'failed') return '';
  const prior = Array.isArray(context.priorDocuments) ? context.priorDocuments : [];
  const requestContextValue = { intent: context.intent, text: context.text || '' };
  const expected = nextDocumentRequest(setting, prior, requestContextValue);
  const matched = documentRequestIds(setting, requestContextValue).filter((id) => documentCoversRequest(doc, id));
  const language = replyLanguage(setting, context.userMessage, context.conversationText);
  const copy = DOCUMENT_REVIEW[language] || DOCUMENT_REVIEW.english;
  const name = (id) => localizedDocumentName(id, language);
  const after = [...prior, doc];
  const skip = new Set(followUpSkipIds(setting, after, requestContextValue, context.history, context.previousReply));
  if (expected && !matched.includes(expected.id)) skip.add(expected.id);
  const next = nextDocumentRequest(setting, after, requestContextValue, [...skip]);
  if (expected && matched.includes(expected.id)) {
    return next ? copy.exactNext(name(expected.id), name(next.id)) : copy.exactDone(name(expected.id));
  }
  if (matched.length) {
    const got = matched[0];
    return next ? copy.other(name(got), name(next.id)) : copy.other(name(got));
  }
  if (expected) return copy.different(next ? name(next.id) : '');
  return next ? copy.received() : copy.receivedDone();
}

const DOCUMENT_NAMES = {
  english: {
    pay_stubs: 'recent pay stubs',
    notice_of_assessment: 'notice of assessment or T4',
    mortgage_statement: 'current mortgage statement',
    preapproval_letter: 'pre-approval letter',
    photo_id: 'photo ID',
    home_photos: 'photos of the home',
    listing_sheet: 'listing or MLS sheet',
    purchase_agreement: 'purchase or sale agreement',
    title_deed: 'title or deed',
    mortgage_commitment: 'mortgage commitment',
    condo_status: 'condo status certificate',
  },
  french: {
    pay_stubs: 'talons de paie récents',
    notice_of_assessment: 'avis de cotisation ou T4',
    mortgage_statement: 'relevé hypothécaire actuel',
    preapproval_letter: 'lettre de préapprobation',
    photo_id: 'pièce d\'identité',
    home_photos: 'photos du logement',
    listing_sheet: 'fiche d\'inscription',
    purchase_agreement: 'promesse d\'achat ou de vente',
    title_deed: 'titre de propriété',
    mortgage_commitment: 'engagement hypothécaire',
    condo_status: 'certificat de l\'état de la copropriété',
  },
  spanish: {
    pay_stubs: 'recibos de nómina recientes',
    notice_of_assessment: 'aviso de evaluación o T4',
    mortgage_statement: 'estado de cuenta hipotecario',
    preapproval_letter: 'carta de preaprobación',
    photo_id: 'identificación con foto',
    home_photos: 'fotos de la vivienda',
    listing_sheet: 'ficha del listado',
    purchase_agreement: 'contrato de compra o venta',
    title_deed: 'título de propiedad',
    mortgage_commitment: 'compromiso hipotecario',
    condo_status: 'certificado de estado del condominio',
  },
  mandarin: {
    pay_stubs: '近期工资单',
    notice_of_assessment: '评估通知或T4',
    mortgage_statement: '当前房贷对账单',
    preapproval_letter: '预批信',
    photo_id: '带照片的身份证件',
    home_photos: '房屋照片',
    listing_sheet: '挂牌资料',
    purchase_agreement: '买卖协议',
    title_deed: '产权文件',
    mortgage_commitment: '贷款承诺函',
    condo_status: '公寓状态证明',
  },
  cantonese: {
    pay_stubs: '近期糧單',
    notice_of_assessment: '評稅通知或T4',
    mortgage_statement: '現時按揭月結單',
    preapproval_letter: '預批信',
    photo_id: '有相身份證明',
    home_photos: '屋企相',
    listing_sheet: '放盤資料',
    purchase_agreement: '買賣合約',
    title_deed: '業權文件',
    mortgage_commitment: '按揭承諾書',
    condo_status: '大廈狀況證明',
  },
  arabic: {
    pay_stubs: 'كشوف الرواتب الأخيرة',
    notice_of_assessment: 'إشعار التقييم أو T4',
    mortgage_statement: 'كشف الرهن الحالي',
    preapproval_letter: 'خطاب الموافقة المبدئية',
    photo_id: 'هوية بصورة',
    home_photos: 'صور المنزل',
    listing_sheet: 'ورقة العرض',
    purchase_agreement: 'عقد البيع أو الشراء',
    title_deed: 'سند الملكية',
    mortgage_commitment: 'التزام الرهن',
    condo_status: 'شهادة حالة الشقة',
  },
  hindi: {
    pay_stubs: 'हाल की वेतन पर्चियाँ',
    notice_of_assessment: 'आकलन नोटिस या T4',
    mortgage_statement: 'मौजूदा गिरवी विवरण',
    preapproval_letter: 'पूर्व-स्वीकृति पत्र',
    photo_id: 'फोटो पहचान',
    home_photos: 'घर की तस्वीरें',
    listing_sheet: 'लिस्टिंग शीट',
    purchase_agreement: 'खरीद या बिक्री समझौता',
    title_deed: 'मालिकाना दस्तावेज़',
    mortgage_commitment: 'गिरवी प्रतिबद्धता',
    condo_status: 'कॉन्डो स्थिति प्रमाणपत्र',
  },
  punjabi: {
    pay_stubs: 'ਹਾਲੀਆ ਤਨਖਾਹ ਸਲਿੱਪਾਂ',
    notice_of_assessment: 'ਮੁਲਾਂਕਣ ਨੋਟਿਸ ਜਾਂ T4',
    mortgage_statement: 'ਮੌਜੂਦਾ ਰਹਿਨ ਬਿਆਨ',
    preapproval_letter: 'ਪ੍ਰੀ-ਅਪਰੂਵਲ ਪੱਤਰ',
    photo_id: 'ਫੋਟੋ ਵਾਲੀ ਪਛਾਣ',
    home_photos: 'ਘਰ ਦੀਆਂ ਤਸਵੀਰਾਂ',
    listing_sheet: 'ਲਿਸਟਿੰਗ ਸ਼ੀਟ',
    purchase_agreement: 'ਖਰੀਦ ਜਾਂ ਵਿਕਰੀ ਇਕਰਾਰ',
    title_deed: 'ਮਲਕੀਅਤ ਦਸਤਾਵੇਜ਼',
    mortgage_commitment: 'ਰਹਿਨ ਵਚਨ',
    condo_status: 'ਕੋਂਡੋ ਸਥਿਤੀ ਸਰਟੀਫਿਕੇਟ',
  },
  tamil: {
    pay_stubs: 'சமீபத்திய சம்பளச் சீட்டுகள்',
    notice_of_assessment: 'மதிப்பீட்டு அறிவிப்பு அல்லது T4',
    mortgage_statement: 'தற்போதைய அடமான அறிக்கை',
    preapproval_letter: 'முன்அனுமதி கடிதம்',
    photo_id: 'புகைப்பட அடையாளம்',
    home_photos: 'வீட்டு புகைப்படங்கள்',
    listing_sheet: 'பட்டியல் தாள்',
    purchase_agreement: 'வாங்கல் அல்லது விற்பனை ஒப்பந்தம்',
    title_deed: 'உரிமைப் பத்திரம்',
    mortgage_commitment: 'அடமான உறுதி',
    condo_status: 'காண்டோ நிலை சான்றிதழ்',
  },
};

const DOCUMENT_ASK = {
  french: (name, quick) => (quick ? `Envoyez ${name} ici.` : `Vous pouvez envoyer ${name} ici.`),
  spanish: (name, quick) => (quick ? `Suba ${name} aquí.` : `Puede subir ${name} aquí.`),
  mandarin: (name) => `请在这里上传${name}。`,
  cantonese: (name) => `請喺呢度上載${name}。`,
  arabic: (name) => `يمكنك رفع ${name} من هنا.`,
  hindi: (name) => `आप ${name} यहाँ भेज सकते हैं।`,
  punjabi: (name) => `ਤੁਸੀਂ ${name} ਇੱਥੇ ਭੇਜ ਸਕਦੇ ਹੋ।`,
  tamil: (name) => `நீங்கள் ${name} இங்கே அனுப்பலாம்.`,
};

function documentAskLine(request, setting, userMessage, conversationText = '') {
  const language = replyLanguage(setting, userMessage, conversationText);
  const names = DOCUMENT_NAMES[language] || DOCUMENT_NAMES.english;
  const name = names[request.id] || DOCUMENT_NAMES.english[request.id] || String(request.label || '').toLowerCase();
  const quick = setting?.communication_style === 'quick';
  const formal = setting?.formality === 'formal' || ['luxury', 'polished'].includes(setting?.personalities?.[0]);
  if (DOCUMENT_ASK[language]) return DOCUMENT_ASK[language](name, quick);
  if (quick) return `Upload your ${name} here.`;
  if (formal) return `Please upload the ${name} here when you are ready.`;
  return `You can upload your ${name} here.`;
}

function requestPatterns(request) {
  const names = [request?.label, ...Object.values(DOCUMENT_NAMES).map((pack) => pack[request?.id])].filter(Boolean);
  return [...new Set(names.map((name) => String(name).toLowerCase().replace(/\s+/g, ' ').trim()))]
    .filter((name) => name.length >= 4);
}

export function requestDocumentForReply(request, reply) {
  if (!request?.label && !request?.id) return null;
  const text = String(reply || '');
    const matched = requestPatterns(request).some((phrase) => {
    const body = phrase.replace(/^(recent|current)\s+/, '');
    const variants = [body, body.replace(/\bstubs\b/g, 'stub'), body.replace(/\bphotos\b/g, 'photo')];
    return variants.some((variant) => {
      const pattern = variant.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
      return new RegExp(pattern, 'i').test(text);
    });
  });
  return matched ? request : null;
}

const OPENING_INTAKE = {
  lawyer: /\b(purchase closing|sale closing|refinance closing)\b/i,
  mortgage_broker: /\b(new mortgage|refinance|renewal|pre-approval)\b/i,
  agent: /\b(buy or sell|buying or selling|looking to buy|looking to sell)\b/i,
};

function isOpeningIntake(reply, role) {
  const pattern = OPENING_INTAKE[role];
  const text = String(reply || '');
  return Boolean(pattern && text.includes('?') && text.length < 320 && pattern.test(text));
}

function isIntentOnly(message) {
  const text = normalizedVisitorText(message);
  if (!text || isGreetingOnly(message) || isVagueYes(message)) return true;
  return /^(yes |yeah |yep )?(i am |im |am )?(looking to |want to |going to |trying to )?(sell|buy|selling|buying)( a home| a house| a property)?$/.test(text);
}

function replyAsks(reply) {
  return /[?？]/.test(String(reply || ''));
}

function withoutDocumentSentence(reply, request) {
  return String(reply || '')
    .split(/(?<=[.!?？])\s+/)
    .filter((sentence) => sentence && !requestDocumentForReply(request, sentence))
    .join(' ')
    .trim();
}

export function applyDocumentAsk(reply, request, { previousReply = '', userMessage = '', setting = null, conversationText = '', qualificationOpen = false } = {}) {
  const text = String(reply || '').trim();
  if (!request?.label || qualificationOpen || isGreetingOnly(userMessage) || isVagueYes(userMessage) || isIntentOnly(userMessage) || visitorPausesDetails(userMessage)) {
    return { reply: withoutDocumentSentence(text, request), request: null };
  }
  if (isOpeningIntake(text, setting?.role)) return { reply: withoutDocumentSentence(text, request), request: null };
  if (requestDocumentForReply(request, previousReply) || requestDocumentForReply(request, text)) return { reply: text, request };
  const previousWasDetail = replyAsks(previousReply) && !isOpeningIntake(previousReply, setting?.role);
  if (replyAsks(text) && !previousWasDetail) return { reply: withoutDocumentSentence(text, request), request: null };
  const line = documentAskLine(request, setting, userMessage, conversationText);
  return { reply: `${text} ${line}`.trim(), request };
}

function clipFacts(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function chunkText(text, size, maxChunks) {
  const source = String(text || '');
  if (source.length <= size) return [source];
  const step = Math.max(size, Math.ceil(source.length / maxChunks));
  const chunks = [];
  for (let start = 0; start < source.length && chunks.length < maxChunks; start += step) {
    chunks.push(source.slice(start, start + size));
  }
  return chunks;
}

async function summarizeExtractedText(text) {
  const source = String(text || '');
  if (!source || !process.env.OPENAI_API_KEY) {
    return {
      summary: source ? source.slice(0, 280) : 'The file is saved.',
      document_type: 'document',
      key_facts: [],
    };
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chunks = chunkText(source, SUMMARY_CHUNK_CHARS, SUMMARY_MAX_CHUNKS);
  const notes = chunks.length === 1
    ? chunks
    : await Promise.all(chunks.map(async (chunk, index) => {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 220,
        messages: [{
          role: 'user',
          content: `Part ${index + 1} of ${chunks.length} of one document. List the facts stated in this part: names, dates, amounts, addresses, and what the part is about. Use only this text. Write every fact in English, even when the part is in another language.\n\n${chunk}`,
        }],
      });
      return `Part ${index + 1}: ${String(completion.choices?.[0]?.message?.content || '').trim()}`;
    }));
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    max_tokens: 320,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `Summarize only the text below. Do not add a subject, name, price, or place that is not written there. Return JSON with summary (two or three sentences covering the whole document), document_type (a short label taken from the content), and key_facts (up to 6 short strings from the text). Write summary, document_type, and key_facts in English only, even when the document is in another language. These fields are shown on the lead. Do not give legal, tax, or lending approval.\n\n${notes.join('\n\n').slice(0, 14000)}`,
    }],
  });
  const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
  return {
    summary: String(parsed.summary || source.slice(0, 280)).slice(0, 600),
    document_type: String(parsed.document_type || 'document').slice(0, 80),
    key_facts: clipFacts(parsed.key_facts),
  };
}

function imageDescriptionRefused(text) {
  const value = String(text || '').trim();
  if (value.replace(/[^A-Za-z0-9]/g, '').length < 40) return true;
  return /^(i can(?:not|'t)|i(?:'m| am) (?:not able|unable)|sorry\b)/i.test(value);
}

async function prepareVisionImage(buffer, mime) {
  const heic = /heic|heif/i.test(mime || '');
  const large = buffer.length > 4 * 1024 * 1024;
  if (!heic && !large) return { buffer, mime: mime || 'image/jpeg' };
  try {
    const sharp = (await import('sharp')).default;
    const source = sharp(buffer, { failOn: 'none', pages: 1 }).rotate();
    const meta = await source.metadata();
    const edge = Math.max(meta.width || 0, meta.height || 0);
    const pipeline = edge > 1600
      ? source.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      : source;
    const out = await pipeline.jpeg({ quality: 72 }).toBuffer();
    return { buffer: out, mime: 'image/jpeg' };
  } catch (error) {
    logger.warn('Chat image prepare failed', { error: error?.message });
    return heic ? null : { buffer, mime: mime || 'image/jpeg' };
  }
}

async function describeImage(buffer, mime) {
  if (!process.env.OPENAI_API_KEY) return 'Image saved.';
  const prepared = await prepareVisionImage(buffer, mime);
  if (!prepared) return 'Photo saved. The picture could not be described.';
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompts = [
    'Describe exactly what is visible in this image in 4 to 6 sentences. If it is a photo, describe the setting, people, clothing, rooms, buildings, or objects. If it is a document or screenshot, quote the visible names, dates, amounts, and addresses. Always describe the picture. Do not say you cannot describe it. Do not name a person unless the name is printed. Do not give legal or lending advice.',
    'This is a normal photo or screenshot. Write a plain description of what you see: people, clothes, rooms, buildings, objects, or printed words. Do not refuse.',
  ];
  let description = '';
  for (const prompt of prompts) {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 280,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${prepared.mime};base64,${prepared.buffer.toString('base64')}` } },
        ],
      }],
    });
    description = String(completion.choices?.[0]?.message?.content || '').trim();
    if (!imageDescriptionRefused(description)) return description;
  }
  return 'Photo saved. The picture could not be described.';
}

export async function rereadUndescribedImages(documents = []) {
  const ids = (Array.isArray(documents) ? documents : [])
    .filter((doc) => {
      if (doc?.kind !== 'image') return false;
      const text = `${doc.extracted_text || ''} ${doc.summary || ''}`;
      if (/could not be described/i.test(text)) return false;
      return imageDescriptionRefused(doc.extracted_text || doc.summary || '');
    })
    .map((doc) => doc._id)
    .filter(Boolean);
  if (!ids.length) return false;
  await Promise.all(ids.map((id) => readChatDocument(id)));
  return true;
}

async function setDocumentReadResult(documentId, fields) {
  await LeadDocument.updateOne({ _id: documentId }, { $set: fields });
}

export async function readChatDocument(documentId) {
  const doc = await LeadDocument.findById(documentId).select('kind mime_type r2_key original_filename').lean();
  if (!doc) return;
  await setDocumentReadResult(documentId, { status: 'reading' });
  try {
    const object = await getObjectFromR2(doc.r2_key);
    let text = '';
    const legacyWord = doc.kind === 'word' && (doc.mime_type === MIME_BY_KIND.doc || isLegacyWordDoc(object.buffer));
    if (legacyWord) {
      text = textFromLegacyDoc(object.buffer);
    } else if (doc.kind === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(object.buffer) });
      try {
        const parsed = await parser.getText();
        text = parsed?.text || '';
      } finally {
        await parser.destroy();
      }
    } else if (doc.kind === 'word') {
      const parsed = await mammoth.extractRawText({ buffer: object.buffer });
      text = parsed?.value || '';
    } else if (doc.kind === 'image') {
      const visionMime = doc.mime_type || 'image/jpeg';
      try {
        text = await describeImage(object.buffer, visionMime);
      } catch (imageError) {
        logger.warn('Chat image description failed', { id: String(documentId), error: imageError?.message });
        text = '';
      }
    }
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_CHARS);
    if (!hasReadableDocumentText({ extracted_text: text })) {
      await setDocumentReadResult(documentId, {
        extracted_text: '',
        text_ready: true,
        summary: doc.kind === 'image' ? 'Photo saved. Open it to view the picture.' : 'No readable text was found in this file.',
        key_facts: [],
        document_type: doc.kind === 'image' ? 'photo' : (doc.kind || 'document'),
        status: 'ready',
      });
      return;
    }
    await setDocumentReadResult(documentId, { extracted_text: text, text_ready: true });
    const summary = await summarizeExtractedText(text);
    await setDocumentReadResult(documentId, {
      summary: summary.summary,
      key_facts: summary.key_facts,
      document_type: summary.document_type,
      status: 'ready',
    });
  } catch (error) {
    logger.warn('Chat document read failed', { id: String(documentId), error: error?.message });
    await setDocumentReadResult(documentId, {
      status: 'failed',
      summary: 'The file is saved. The text could not be read.',
    });
  }
}

export async function extractTextFromUpload(buffer, declaredMime = '', filename = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  const name = String(filename || '').toLowerCase();
  const mime = String(declaredMime || '').toLowerCase();
  if (mime.startsWith('text/') || /\.(txt|md|csv)$/.test(name)) {
    return bytes.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_CHARS);
  }
  const sniff = sniffChatFile(bytes, declaredMime, filename);
  if (!sniff.ok) return '';
  let text = '';
  if (sniff.kind === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const parsed = await parser.getText();
      text = parsed?.text || '';
    } finally {
      await parser.destroy();
    }
  } else if (sniff.kind === 'word') {
    text = sniff.mime === MIME_BY_KIND.doc || isLegacyWordDoc(bytes)
      ? textFromLegacyDoc(bytes)
      : (await mammoth.extractRawText({ buffer: bytes }))?.value || '';
  } else if (sniff.kind === 'image') {
    try {
      text = await describeImage(bytes, sniff.mime);
    } catch {
      text = '';
    }
  }
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_CHARS);
}

function zipEntry(buffer, wanted) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  let offset = 0;
  while (offset + 30 < bytes.length) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) return null;
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) return null;
    if (name === wanted) {
      const data = bytes.subarray(dataStart, dataEnd);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      return null;
    }
    offset = dataEnd;
  }
  return null;
}

function pagesFromWordXml(xml) {
  const source = String(xml || '');
  const rendered = (source.match(/<w:lastRenderedPageBreak\/>/g) || []).length;
  const explicit = (source.match(/w:type="page"/g) || []).length;
  const breaks = Math.max(rendered, explicit);
  if (breaks > 0) return breaks + 1;
  return 1;
}

function isLegacyWordDoc(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  return bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
}

function legacyTextRun(bytes, start) {
  const pieces = [];
  let codes = [];
  const flush = () => {
    if (codes.length < 16) {
      codes = [];
      return;
    }
    const text = String.fromCharCode(...codes).replace(/\s+/g, ' ').trim();
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters >= 12 && letters / Math.max(text.length, 1) >= 0.5) pieces.push(text);
    codes = [];
  };
  for (let index = start; index + 1 < bytes.length; index += 2) {
    const code = bytes.readUInt16LE(index);
    const letter = (code >= 0x30 && code <= 0x39)
      || (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x00c0 && code <= 0x024f)
      || (code >= 0x0600 && code <= 0x06ff)
      || (code >= 0x0900 && code <= 0x097f)
      || (code >= 0x0a00 && code <= 0x0a7f)
      || (code >= 0x0b80 && code <= 0x0bff)
      || (code >= 0x4e00 && code <= 0x9fff);
    const space = code === 9 || code === 10 || code === 13 || code === 32 || code === 0xa0;
    const punct = '.,;:!?\'"-()/&%$#@'.includes(String.fromCharCode(code));
    if (letter || space || punct) codes.push(space ? 32 : code);
    else flush();
  }
  flush();
  return pieces;
}

export function textFromLegacyDoc(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const pieces = [...legacyTextRun(bytes, 0), ...legacyTextRun(bytes, 1)];
  const unique = [];
  for (const piece of pieces) {
    if (!unique.some((item) => item.includes(piece) || piece.includes(item))) unique.push(piece);
  }
  return unique.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_CHARS);
}

export async function countDocumentPages(buffer, kind) {
  if (kind === 'image') return 1;
  if (kind === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const info = await parser.getInfo();
      return Number(info?.total) || 0;
    } finally {
      await parser.destroy();
    }
  }
  if (kind === 'word') {
    const xml = zipEntry(buffer, 'word/document.xml');
    if (xml) return pagesFromWordXml(xml.toString('utf8'));
    if (isLegacyWordDoc(buffer)) return 1;
    return 0;
  }
  return 0;
}

export async function assertChatDocumentLimits(buffer, kind) {
  if (buffer.length > MAX_CHATBOT_ATTACHMENT_BYTES) {
    const error = new Error('This file is over 10 MB. Upload an agreement of 10 pages or less.');
    error.status = 400;
    throw error;
  }
  let pages = 0;
  try {
    pages = await countDocumentPages(buffer, kind);
  } catch {
    const error = new Error('The pages in this file could not be read.');
    error.status = 400;
    throw error;
  }
  if (!pages) {
    const error = new Error('The pages in this file could not be read.');
    error.status = 400;
    throw error;
  }
  if (pages > MAX_DOCUMENT_PAGES) {
    const error = new Error(`This file has ${pages} pages. Upload an agreement of ${MAX_DOCUMENT_PAGES} pages or less.`);
    error.status = 400;
    throw error;
  }
}

export async function countConversationDocuments({ userId, sessionId, conversationId }) {
  return LeadDocument.countDocuments({
    user_id: userId,
    $or: [
      conversationId ? { conversation_id: conversationId } : null,
      sessionId ? { session_id: sessionId } : null,
    ].filter(Boolean),
  });
}

export async function saveChatDocument({
  userId,
  sessionId,
  conversationId = null,
  buffer,
  filename,
  declaredMime,
  preview = false,
}) {
  const sniffed = sniffChatFile(buffer, declaredMime, filename);
  if (!sniffed.ok) {
    const error = new Error(sniffed.reason);
    error.status = 400;
    throw error;
  }
  const count = await countConversationDocuments({ userId, sessionId, conversationId });
  if (count >= MAX_FILES_PER_CONVERSATION) {
    const error = new Error('This conversation already has 10 files.');
    error.status = 400;
    throw error;
  }
  await assertChatDocumentLimits(buffer, sniffed.kind);
  const ext = sniffed.kind === 'pdf' ? '.pdf' : sniffed.kind === 'word' ? (sniffed.mime === MIME_BY_KIND.doc ? '.doc' : '.docx') : sniffed.mime === MIME_BY_KIND.png ? '.png' : sniffed.mime === MIME_BY_KIND.webp ? '.webp' : sniffed.mime === MIME_BY_KIND.heic ? '.heic' : '.jpg';
  const key = `nesti/chatbot/${userId}/${sessionId || 'session'}/${crypto.randomBytes(8).toString('hex')}${ext}`;
  await uploadBufferToR2(buffer, {
    key,
    mimeType: sniffed.mime,
    cacheControl: 'private, no-store',
    contentDisposition: 'inline',
  });
  const doc = await LeadDocument.create({
    user_id: userId,
    conversation_id: conversationId,
    session_id: sessionId || '',
    original_filename: String(filename || 'document').slice(0, 180),
    mime_type: sniffed.mime,
    bytes: buffer.length,
    kind: sniffed.kind,
    r2_key: key,
    status: 'uploaded',
    preview: preview === true,
  });
  void readChatDocument(doc._id);
  return doc;
}

export async function signStoredAttachments(attachments = []) {
  const rows = Array.isArray(attachments) ? attachments : [];
  const ids = rows.map((file) => String(file?.id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id));
  const docs = ids.length
    ? await LeadDocument.find({ _id: { $in: ids } }).select('r2_key original_filename mime_type').lean()
    : [];
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  return Promise.all(rows.map(async (file) => {
    const doc = byId.get(String(file?.id || ''));
    if (!doc?.r2_key) return file;
    try {
      const openUrl = await createSignedReadUrl(doc.r2_key, {
        expiresIn: 10 * 60,
        download: false,
        filename: doc.original_filename || file.original_filename,
        responseContentType: doc.mime_type || file.mime_type,
      });
      return { ...file, open_url: openUrl };
    } catch {
      return file;
    }
  }));
}

export async function publicDocumentView(doc) {
  const sign = (download) => createSignedReadUrl(doc.r2_key, {
    expiresIn: 10 * 60,
    download,
    filename: doc.original_filename,
    responseContentType: doc.mime_type,
  });
  const [openUrl, downloadUrl] = await Promise.all([sign(false), sign(true)]);
  return {
    id: String(doc._id),
    original_filename: doc.original_filename,
    mime_type: doc.mime_type,
    bytes: doc.bytes,
    kind: doc.kind,
    status: doc.status,
    summary: doc.summary || '',
    key_facts: doc.key_facts || [],
    document_type: doc.document_type || '',
    created_at: doc.createdAt,
    open_url: openUrl,
    download_url: downloadUrl,
  };
}

export async function loadConversationDocuments({ userId, conversationId, sessionId, includePreview = false }) {
  return LeadDocument.find({
    user_id: userId,
    ...(includePreview ? {} : { preview: { $ne: true } }),
    $or: [
      conversationId ? { conversation_id: conversationId } : null,
      sessionId ? { session_id: sessionId } : null,
    ].filter(Boolean),
  }).sort({ createdAt: 1 }).lean();
}

export async function attachDocumentsToTurn({ userId, conversationId, sessionId, attachmentIds = [] }) {
  const ids = (Array.isArray(attachmentIds) ? attachmentIds : [])
    .map(String)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .slice(0, 3);
  if (!ids.length) return [];
  const docs = await LeadDocument.find({
    _id: { $in: ids },
    user_id: userId,
    $or: [{ session_id: sessionId }, { conversation_id: conversationId }],
  }).lean();
  if (docs.length) {
    await LeadDocument.updateMany(
      { _id: { $in: docs.map((doc) => doc._id) } },
      { $set: { conversation_id: conversationId, ...(sessionId ? { session_id: sessionId } : {}) } },
    );
  }
  return docs.map((doc) => ({
    id: String(doc._id),
    original_filename: doc.original_filename,
    kind: doc.kind,
    mime_type: doc.mime_type,
    status: doc.status,
  }));
}

export function leadDocumentLinkFilter({ userId, conversationId, sessionId }) {
  return {
    user_id: userId,
    preview: { $ne: true },
    lead_match_id: null,
    $or: [
      conversationId ? { conversation_id: conversationId } : null,
      sessionId ? { session_id: sessionId } : null,
    ].filter(Boolean),
  };
}

export async function linkConversationDocumentsToLead({ userId, conversationId, sessionId, leadMatchId, preview = false }) {
  if (preview || !leadMatchId || !userId || (!conversationId && !sessionId)) return { linked: 0 };
  const result = await LeadDocument.updateMany(
    leadDocumentLinkFilter({ userId, conversationId, sessionId }),
    { $set: { lead_match_id: leadMatchId, conversation_id: conversationId || undefined } },
  );
  return { linked: result.modifiedCount || 0 };
}

export async function listLeadDocuments(userId, leadMatchId) {
  const lead = await LeadMatch.findOne({ _id: leadMatchId, user_id: userId })
    .select('conversation_id compatibility_factors.session_id')
    .lean();
  if (lead) {
    await linkConversationDocumentsToLead({
      userId,
      conversationId: lead.conversation_id,
      sessionId: lead.compatibility_factors?.session_id,
      leadMatchId,
    });
  }
  const docs = await LeadDocument.find({
    user_id: userId,
    lead_match_id: leadMatchId,
    preview: { $ne: true },
  }).sort({ createdAt: -1 }).lean();
  return Promise.all(docs.map((doc) => publicDocumentView(doc)));
}

export async function deleteLeadDocument(userId, leadMatchId, documentId) {
  const doc = await LeadDocument.findOne({ _id: documentId, user_id: userId, lead_match_id: leadMatchId });
  if (!doc) return false;
  await deleteObjectFromR2(doc.r2_key);
  await doc.deleteOne();
  return true;
}
