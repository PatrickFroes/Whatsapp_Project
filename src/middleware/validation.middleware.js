/**
 * validation.middleware.js - Middleware de validação usando Zod schemas
 * Aplica validação de request body, params, query
 */

const logger = require('../utils/logger');

/**
 * Middleware genérico para validar request body
 * @param {ZodSchema} schema - Zod schema para validação
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.body);

      if (!result.success) {
        const errors = result.error.flatten();
        logger.warn(`[Validation] Body validation failed: ${req.method} ${req.path}`, {
          errors: errors.fieldErrors,
          ip: req.ip
        });

        return res.status(400).json({
          error: 'Validation failed',
          details: errors.fieldErrors
        });
      }

      // Attacha dados validados ao request
      req.validatedBody = result.data;
      next();
    } catch (error) {
      logger.error('[Validation] Unexpected error in validateBody', {
        error: error.message
      });
      res.status(500).json({ error: 'Validation error' });
    }
  };
}

/**
 * Middleware para validar params
 */
function validateParams(schema) {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.params);

      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid parameters',
          details: result.error.flatten().fieldErrors
        });
      }

      req.validatedParams = result.data;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Parameter validation error' });
    }
  };
}

/**
 * Middleware para validar query
 */
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.query);

      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: result.error.flatten().fieldErrors
        });
      }

      req.validatedQuery = result.data;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Query validation error' });
    }
  };
}

module.exports = {
  validateBody,
  validateParams,
  validateQuery
};
