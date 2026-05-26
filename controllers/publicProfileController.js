import {
  getPublicProfileBySlugService,
  getPublicProfessionalsListService,
  getPublicProfessionalNetworkService,
  getSellerPropertiesBySlugService,
  trackProfileViewService,
  checkSlugAvailabilityService,
  submitPublicLeadService,
} from '../services/publicProfile/publicProfileService.js';

const send = (res, result) => {
  res.status(result.status).json(result.body);
};

export const getPublicProfileBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;
    send(res, await getPublicProfileBySlugService(slug));
  } catch (error) {
    next(error);
  }
};

export const trackProfileView = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const visitorData = {
      visitor_id: req.body.visitor_id || req.ip,
      visitor_user_id: req.user?.user_id || null,
      event_type: req.body.event_type || 'profile_view',
      event_data: req.body.event_data || {},
      session_id: req.body.session_id,
      referrer: req.get('Referer') || req.body.referrer,
      user_agent: req.get('User-Agent'),
      ip_address: req.ip,
      listing_id: req.body.listing_id || null,
      service_id: req.body.service_id || null,
      cta_type: req.body.cta_type || null,
      duration_seconds: req.body.duration_seconds || null,
    };
    
    send(res, await trackProfileViewService(slug, visitorData));
  } catch (error) {
    next(error);
  }
};

export const getPublicProfessionalsList = async (req, res, next) => {
  try {
    const { role, limit = 12, exclude } = req.query;
    send(res, await getPublicProfessionalsListService({ role, limit: Number(limit), exclude }));
  } catch (error) {
    next(error);
  }
};

export const getPublicProfessionalNetwork = async (req, res, next) => {
  try {
    const { role, limit = 60, exclude } = req.query;
    send(res, await getPublicProfessionalNetworkService({ role, limit: Number(limit), exclude }));
  } catch (error) {
    next(error);
  }
};

export const getSellerProperties = async (req, res, next) => {
  try {
    const { slug } = req.params;
    send(res, await getSellerPropertiesBySlugService(slug));
  } catch (error) {
    next(error);
  }
};

export const checkSlugAvailability = async (req, res, next) => {
  try {
    const { slug } = req.body;
    const userId = req.user?.user_id || null;
    send(res, await checkSlugAvailabilityService(slug, userId));
  } catch (error) {
    next(error);
  }
};

export const submitPublicLead = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const payload = req.body || {};
    const requestMeta = {
      visitor_user_id: req.user?._id || req.user?.user_id || null,
      referrer: req.get('Referer') || '',
      user_agent: req.get('User-Agent') || '',
      ip_address: req.ip || null,
    };
    send(res, await submitPublicLeadService({ slug, payload, requestMeta }));
  } catch (error) {
    next(error);
  }
};
