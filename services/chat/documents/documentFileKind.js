import zlib from 'node:zlib';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { MAX_CHATBOT_ATTACHMENT_BYTES } from '../../../middleware/uploadChatbotAttachment.js';

export const MAX_DOCUMENT_PAGES = 10;

export const MAX_EXTRACTED_CHARS = 120000;

export const MIME_BY_KIND = {
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

export function isLegacyWordDoc(buffer) {
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
