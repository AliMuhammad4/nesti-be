import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import {
  draftFaqs,
  readAssistantForUser,
  saveAssistantForUser,
} from '../services/professionalAssistant/professionalAssistantService.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';

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
