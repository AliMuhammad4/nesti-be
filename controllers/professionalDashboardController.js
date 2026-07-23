import {
  getOwnPublicProfileService,
  updatePublicProfileService,
  getProfileAnalyticsService,
  exportProfileAnalyticsService,
  updateThemeService,
  generatePublicProfileCopyService,
  deletePublicProfileService,
  getOwnStorefrontDraftService,
  getOwnStorefrontPropertiesService,
  saveStorefrontDraftService,
  publishStorefrontService,
  generateStorefrontDraftService,
} from '../services/publicProfile/professionalDashboardService.js';

const send = (res, result) => {
  res.status(result.status).json(result.body);
};

export const getOwnPublicProfile = async (req, res, next) => {
  try {
    const userId = req.user._id;
    send(res, await getOwnPublicProfileService(userId));
  } catch (error) {
    next(error);
  }
};

export const updatePublicProfile = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const updates = req.body;
    send(res, await updatePublicProfileService(userId, updates));
  } catch (error) {
    next(error);
  }
};

export const getOwnStorefrontDraft = async (req, res, next) => {
  try {
    send(res, await getOwnStorefrontDraftService(req.user._id));
  } catch (error) {
    next(error);
  }
};

export const getOwnStorefrontProperties = async (req, res, next) => {
  try {
    send(res, await getOwnStorefrontPropertiesService(req.user._id));
  } catch (error) {
    next(error);
  }
};

export const saveStorefrontDraft = async (req, res, next) => {
  try {
    send(res, await saveStorefrontDraftService(req.user._id, req.body.draft));
  } catch (error) {
    next(error);
  }
};

export const publishStorefront = async (req, res, next) => {
  try {
    send(res, await publishStorefrontService(req.user._id));
  } catch (error) {
    next(error);
  }
};

export const generateStorefrontDraft = async (req, res, next) => {
  try {
    send(res, await generateStorefrontDraftService(req.user._id, req.body || {}));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const generatePublicProfileCopy = async (req, res, next) => {
  try {
    const userId = req.user._id;
    send(res, await generatePublicProfileCopyService(userId));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const deletePublicProfile = async (req, res, next) => {
  try {
    const userId = req.user._id;
    send(res, await deletePublicProfileService(userId));
  } catch (error) {
    next(error);
  }
};

export const getProfileAnalytics = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { period, start_date, end_date } = req.query;
    
    send(
      res,
      await getProfileAnalyticsService(userId, {
        period: period || 'daily',
        start_date,
        end_date,
      })
    );
  } catch (error) {
    next(error);
  }
};

export const exportProfileAnalytics = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { period, start_date, end_date, format } = req.query;
    
    const result = await exportProfileAnalyticsService(userId, {
      period: period || 'daily',
      start_date,
      end_date,
      format: format || 'json',
    });
    
    if (result.status === 200 && format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=analytics.csv');
      res.status(200).send(result.body.data);
    } else {
      send(res, result);
    }
  } catch (error) {
    next(error);
  }
};

export const updateTheme = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { theme_color, custom_css } = req.body;
    
    send(res, await updateThemeService(userId, { theme_color, custom_css }));
  } catch (error) {
    next(error);
  }
};
