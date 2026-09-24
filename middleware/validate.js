export function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    req.body = value;
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    // Express 5 exposes `req.query` as read-only; keep validated params separately.
    req.validatedQuery = value;
    next();
  };
}

/**
 * Require acting_user_id from body or query (admin-as-professional referral routes).
 */
export function validateActingUserId(schema) {
  return (req, res, next) => {
    const acting_user_id = req.body?.acting_user_id ?? req.query?.acting_user_id;
    const { error, value } = schema.validate(
      { acting_user_id },
      { abortEarly: false, stripUnknown: true },
    );
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    if (!req.body || typeof req.body !== 'object') {
      req.body = {};
    }
    req.body.acting_user_id = value.acting_user_id;
    next();
  };
}

