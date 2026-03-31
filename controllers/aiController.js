import { getLeadInsights } from '../services/ai/leadInsights.js';
import { getQuestionnaire, scoreQuestionnaire } from '../services/ai/questionnaires.js';
import { getProfessionalGuidance, toggleAutomation } from '../services/ai/automation.js';
export const getGuidance = async (req, res) => {
  const result = getProfessionalGuidance();
  res.json(result);
};
export const getInsights = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { conversation_id } = req.params;
    const result = await getLeadInsights({
      userId,
      conversationId: conversation_id,
    });
    if (!result.success && result.status === 404) {
      return res.status(404).json({ success: false, message: result.message });
    }
    res.json({ success: true, insights: result.insights });
  } catch (error) {
    next(error);
  }
};

export const getQuestionnaireHandler = async (req, res) => {
  const { type } = req.params;
  const result = getQuestionnaire(type);
  res.json(result);
};

export const scoreQuestionnaireHandler = async (req, res) => {
  const payload = req.body;
  const result = scoreQuestionnaire(payload);
  res.json(result);
};

export const toggleAutomationHandler = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { conversation_id } = req.params;
    const result = await toggleAutomation({
      userId,
      conversationId: conversation_id,
    });
    if (!result.success && result.status === 404) {
      return res.status(404).json({ success: false, message: result.message });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
};
