import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import {
  getResolvedPropertyMatchScoring,
  parseFullPropertyMatchScoringPayload,
} from '../../services/agent/propertyMatch/scoringConfig.js';

export const getMyPropertyMatchScoring = async (req, res, next) => {
  try {
    const profile = await ProfessionalProfile.findOne({ user_id: req.user._id }).lean();
    if (!profile || profile.professional_type !== 'agent') {
      return res.status(404).json({
        success: false,
        code:    'NOT_AGENT_PROFILE',
        message: 'Property match scoring is only available for agent accounts.',
      });
    }

    const resolved = await getResolvedPropertyMatchScoring(req.user._id);
    if (!resolved) {
      return res.status(404).json({
        success: false,
        code:    'PROPERTY_MATCH_SCORING_NOT_AVAILABLE',
        message: 'Could not resolve scoring configuration.',
      });
    }

    res.json({
      success: true,
      scoring: resolved,
      source:  profile.property_match_scoring ? 'profile' : 'default',
    });
  } catch (e) {
    next(e);
  }
};

export const putMyPropertyMatchScoring = async (req, res, next) => {
  try {
    const parsed = parseFullPropertyMatchScoringPayload(req.body);
    if (!parsed) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid body: require buyer (all buyer fields), seller (all seller fields), maxDisplayScore, maxMatches, inventoryLimit — all finite numbers.',
      });
    }

    const updated = await ProfessionalProfile.findOneAndUpdate(
      { user_id: req.user._id, professional_type: 'agent' },
      {
        $set: {
          property_match_scoring: {
            buyer:           parsed.buyer,
            seller:          parsed.seller,
            maxDisplayScore: parsed.maxDisplayScore,
            maxMatches:      parsed.maxMatches,
            inventoryLimit:  parsed.inventoryLimit,
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Agent professional profile not found.',
      });
    }

    const resolved = await getResolvedPropertyMatchScoring(req.user._id);
    res.json({ success: true, scoring: resolved, source: 'profile' });
  } catch (e) {
    next(e);
  }
};
