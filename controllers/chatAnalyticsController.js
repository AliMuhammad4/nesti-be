import mongoose from 'mongoose';
import LeadMatch from '../models/LeadMatch.js';
import {
  getLeadKpiSummary,
  getLeadKpiFunnel,
  getLeadKpiTimeseries,
  getLeadKpiEventsForLead,
  getLeadIntentAndBudgetTrends,
} from '../services/analytics/leadKpiService.js';

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

export async function getChatAnalyticsTimeseries(req, res, next) {
  try {
    const days = req.query.days;
    const timeseries = await getLeadKpiTimeseries(req.user._id, { days });
    return res.json({ success: true, ...timeseries });
  } catch (error) {
    return next(error);
  }
}

export async function getChatAnalyticsLeadTrends(req, res, next) {
  try {
    const days = req.query.days;
    const trends = await getLeadIntentAndBudgetTrends(req.user._id, { days });
    return res.json({ success: true, ...trends });
  } catch (error) {
    return next(error);
  }
}

export async function getLeadKpiTimeline(req, res, next) {
  try {
    const { lead_match_id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(lead_match_id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead_match_id' });
    }
    const owned = await LeadMatch.exists({ _id: lead_match_id, user_id: req.user._id });
    if (!owned) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const days = req.query.days;
    const limit = req.query.limit;
    const timeline = await getLeadKpiEventsForLead(req.user._id, lead_match_id, { days, limit });
    return res.json({ success: true, lead_match_id, ...timeline });
  } catch (error) {
    return next(error);
  }
}
