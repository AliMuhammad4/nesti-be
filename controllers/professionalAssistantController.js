import { randomUUID } from 'node:crypto';
import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import {
  draftFaqs,
  readAssistantForUser,
  saveAssistantForUser,
} from '../services/professionalAssistant/professionalAssistantService.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import { isR2Configured, uploadBufferToR2 } from '../services/media/r2Client.js';
import { extractTextFromUpload } from '../services/chat/documents/chatDocumentService.js';

const ASSET_KINDS = new Set(['logo', 'avatar']);
const KNOWLEDGE_KINDS = new Set(['bio', 'services', 'faqs', 'marketing', 'other']);

function requireProfessional(req, res) {
  if (!PROFESSIONAL_TYPE_VALUES.includes(req.user?.role)) {
    res.status(403).json({ success: false, message: 'Only professionals can customize this assistant.' });
    return false;
  }
  return true;
}

export async function getMyAssistant(req, res, next) {
  try {
    if (!requireProfessional(req, res)) return;
    const payload = await readAssistantForUser(req.user);
    if (!payload) return res.status(403).json({ success: false, message: 'Only professionals can customize this assistant.' });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return next(error);
  }
}

export async function saveMyAssistant(req, res, next) {
  try {
    if (!requireProfessional(req, res)) return;
    const draft = await saveAssistantForUser(req.user, req.body || {});
    if (!draft) return res.status(403).json({ success: false, message: 'Only professionals can customize this assistant.' });
    return res.json({ success: true, applied: draft.applied, draft });
  } catch (error) {
    return next(error);
  }
}

export async function uploadMyAssistantAsset(req, res, next) {
  try {
    if (!requireProfessional(req, res)) return;
    const kind = String(req.body?.kind || '').trim().toLowerCase();
    if (!ASSET_KINDS.has(kind)) {
      return res.status(400).json({ success: false, message: 'Invalid kind. Use logo or avatar.' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'Missing image file (field name: file).' });
    }
    if (!isR2Configured()) {
      return res.status(503).json({ success: false, message: 'Image upload is not configured.' });
    }
    const version = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const result = await uploadBufferToR2(req.file.buffer, {
      key: `nesti/users/${req.user._id}/assistant/${kind}-${version}`,
      mimeType: req.file.mimetype,
      cacheControl: 'public, max-age=31536000, immutable',
    });
    if (!result?.secure_url) {
      return res.status(502).json({ success: false, message: 'Upload failed: no URL returned.' });
    }
    return res.json({ success: true, kind, url: result.secure_url });
  } catch (error) {
    return next(error);
  }
}

export async function uploadMyAssistantKnowledge(req, res, next) {
  try {
    if (!requireProfessional(req, res)) return;
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: 'Missing file (field name: file).' });
    }
    const kind = KNOWLEDGE_KINDS.has(req.body?.kind) ? req.body.kind : 'other';
    const text = await extractTextFromUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text || text.replace(/[^A-Za-z0-9]/g, '').length < 20) {
      return res.status(400).json({ success: false, message: 'No readable text was found in this file.' });
    }
    return res.json({
      success: true,
      file: {
        id: `knowledge-${randomUUID()}`,
        name: String(req.file.originalname || 'Upload').slice(0, 120),
        kind,
        text: text.slice(0, 6000),
        uploaded_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function draftMyAssistantFaqs(req, res, next) {
  try {
    if (!requireProfessional(req, res)) return;
    const current = await readAssistantForUser(req.user);
    if (!current) return res.status(403).json({ success: false, message: 'Only professionals can customize this assistant.' });
    const profile = await ProfessionalProfile.findOne({ user_id: req.user._id }).lean();
    const setting = { ...current.draft, ...(req.body || {}), role: current.role };
    return res.json({ success: true, faqs: draftFaqs(setting, profile) });
  } catch (error) {
    return next(error);
  }
}
