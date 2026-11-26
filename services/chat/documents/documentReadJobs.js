import mammoth from 'mammoth';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
import LeadDocument from '../../../models/LeadDocument.js';
import logger from '../../../utils/logger.js';
import { getObjectFromR2 } from '../../media/r2Client.js';
import {
  MAX_EXTRACTED_CHARS,
  MIME_BY_KIND,
  isLegacyWordDoc,
  textFromLegacyDoc,
} from './documentFileKind.js';
import { hasReadableDocumentText } from './documentPromptText.js';

const SUMMARY_CHUNK_CHARS = 8000;
const SUMMARY_MAX_CHUNKS = 8;

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

const readsInFlight = new Set();

async function setDocumentReadResult(documentId, fields) {
  await LeadDocument.updateOne({ _id: documentId }, { $set: fields });
}

/** A restart drops the in-process read. Start it again before the reply decides the file matches. */
export async function resumeDocumentReads(documentsOrIds = []) {
  const rows = Array.isArray(documentsOrIds) ? documentsOrIds : [];
  const ids = rows
    .map((item) => item?._id || item?.id || item)
    .map((id) => String(id || ''))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return;
  const known = rows.every((item) => item && typeof item === 'object' && item.status)
    ? rows
    : await LeadDocument.find({ _id: { $in: ids } }).select('status').lean();
  known.forEach((doc) => {
    const id = doc?._id;
    if (!id || doc.status === 'ready' || doc.status === 'failed') return;
    const key = String(id);
    if (readsInFlight.has(key)) return;
    void readChatDocument(id).catch((error) => {
      logger.warn('Chat document resume failed', { id: key, error: error?.message });
    });
  });
}

export async function readChatDocument(documentId) {
  const key = String(documentId || '');
  if (!key || readsInFlight.has(key)) return;
  readsInFlight.add(key);
  try {
    await readChatDocumentBody(documentId);
  } catch (error) {
    // One file's failure (lookup or status write) must not abort the other reads or crash the API.
    logger.warn('Chat document read crashed', { id: key, error: error?.message });
  } finally {
    readsInFlight.delete(key);
  }
}

async function readChatDocumentBody(documentId) {
  const doc = await LeadDocument.findById(documentId).select('kind mime_type r2_key original_filename status').lean();
  if (!doc || doc.status === 'ready') return;
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
