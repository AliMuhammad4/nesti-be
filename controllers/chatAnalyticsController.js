import { getLeadKpiSummary, getLeadKpiFunnel } from '../services/analytics/leadKpiService.js';

export async function getChatAnalyticsSummary(req, res, next) {
  try {
    const days = req.query.days;
    const summary = await getLeadKpiSummary(req.user._id, { days });
    return res.json({ success: true, summary });
  } catch (error) {
    return next(error);
  }
}

export async function getChatAnalyticsFunnel(req, res, next) {
  try {
    const days = req.query.days;
    const funnel = await getLeadKpiFunnel(req.user._id, { days });
    return res.json({ success: true, funnel });
  } catch (error) {
    return next(error);
  }
}
