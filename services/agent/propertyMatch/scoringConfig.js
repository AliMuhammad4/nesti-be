import ProfessionalProfile from '../../../models/ProfessionalProfile.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';

const BUYER_KEYS = [
  'baseScore',
  'budgetWithinCapMult',
  'budgetWithinPoints',
  'budgetSlightCapMult',
  'budgetSlightPoints',
  'budgetOverPenalty',
  'bedsMatchPoints',
  'bedsClosePoints',
  'bedsUnderPenalty',
  'areaPoints',
  'typePoints',
  'pickMinScore',
];

const SELLER_KEYS = [
  'baseScore',
  'areaPoints',
  'priceTightLowMult',
  'priceTightHighMult',
  'priceTightPoints',
  'priceWideLowMult',
  'priceWideHighMult',
  'priceWidePoints',
  'priceMissPenalty',
  'bedSamePoints',
  'bedClosePoints',
  'typePoints',
  'pickMinScore',
];

const DEFAULT_PROPERTY_MATCH_SCORING = {
  buyer: {
    baseScore:           50,
    budgetWithinCapMult: 1.1,
    budgetWithinPoints:  25,
    budgetSlightCapMult:   1.25,
    budgetSlightPoints:    10,
    budgetOverPenalty:     -20,
    bedsMatchPoints:       15,
    bedsClosePoints:       5,
    bedsUnderPenalty:      -15,
    areaPoints:            20,
    typePoints:            10,
    pickMinScore:          25,
  },
  seller: {
    baseScore:           45,
    areaPoints:          30,
    priceTightLowMult:   0.65,
    priceTightHighMult:  1.45,
    priceTightPoints:    25,
    priceWideLowMult:    0.45,
    priceWideHighMult:   1.65,
    priceWidePoints:     10,
    priceMissPenalty:    -10,
    bedSamePoints:       15,
    bedClosePoints:      8,
    typePoints:          10,
    pickMinScore:        30,
  },
  maxDisplayScore: 100,
  maxMatches:      5,
  inventoryLimit: 40,
};

function pickBuyer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = {};
  for (const k of BUYER_KEYS) {
    const n = Number(raw[k]);
    if (!Number.isFinite(n)) return null;
    o[k] = n;
  }
  return o;
}

function pickSeller(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = {};
  for (const k of SELLER_KEYS) {
    const n = Number(raw[k]);
    if (!Number.isFinite(n)) return null;
    o[k] = n;
  }
  return o;
}

function pickGlobals(doc) {
  const maxDisplayScore = Number(doc?.maxDisplayScore);
  const maxMatches = Number(doc?.maxMatches);
  const inventoryLimit = Number(doc?.inventoryLimit);
  if (!Number.isFinite(maxDisplayScore)) return null;
  if (!Number.isFinite(maxMatches) || maxMatches < 1) return null;
  if (!Number.isFinite(inventoryLimit) || inventoryLimit < 1) return null;
  return { maxDisplayScore, maxMatches, inventoryLimit };
}

function resolvedFromDoc(doc) {
  if (!doc) return null;
  const buyer = pickBuyer(doc.buyer);
  const seller = pickSeller(doc.seller);
  const g = pickGlobals(doc);
  if (!buyer || !seller || !g) return null;
  return { buyer, seller, ...g };
}

function resolvedFromDefaults() {
  const buyer = pickBuyer(DEFAULT_PROPERTY_MATCH_SCORING.buyer);
  const seller = pickSeller(DEFAULT_PROPERTY_MATCH_SCORING.seller);
  const g = pickGlobals(DEFAULT_PROPERTY_MATCH_SCORING);
  if (!buyer || !seller || !g) return null;
  return { buyer, seller, ...g };
}

/** Loads scoring from the agent's ProfessionalProfile; falls back to defaults so matching works before first save. */
export async function getResolvedPropertyMatchScoring(userId) {
  const profile = await ProfessionalProfile.findOne({ user_id: userId }).lean();
  if (!profile || profile.professional_type !== PROFESSIONAL_TYPE.AGENT) return null;

  const fromProfile = resolvedFromDoc(profile.property_match_scoring);
  if (fromProfile) return fromProfile;

  return resolvedFromDefaults();
}

export function parseFullPropertyMatchScoringPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const buyer = pickBuyer(body.buyer);
  const seller = pickSeller(body.seller);
  const g = pickGlobals(body);
  if (!buyer || !seller || !g) return null;
  return { buyer, seller, ...g };
}

/** Persist defaults on ProfessionalProfile when missing (signup / seed). */
export async function ensureAgentPropertyMatchScoring(userId) {
  const profile = await ProfessionalProfile.findOne({ user_id: userId }).lean();
  if (!profile || profile.professional_type !== PROFESSIONAL_TYPE.AGENT) return false;

  if (resolvedFromDoc(profile.property_match_scoring)) return true;

  const buyer = pickBuyer(DEFAULT_PROPERTY_MATCH_SCORING.buyer);
  const seller = pickSeller(DEFAULT_PROPERTY_MATCH_SCORING.seller);
  const g = pickGlobals(DEFAULT_PROPERTY_MATCH_SCORING);
  if (!buyer || !seller || !g) return false;

  await ProfessionalProfile.updateOne(
    { user_id: userId },
    { $set: { property_match_scoring: { buyer, seller, ...g } } }
  );
  return true;
}
