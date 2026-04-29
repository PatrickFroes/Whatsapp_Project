/**
 * queryLimits.middleware.js - Middleware para validar e limitar parâmetros de query
 * Previne ataques que tentam consumir memória/recursos através de limites altos
 */

const logger = require('../utils/logger');

/**
 * Middleware para validar limites de pagination
 * Garante que page e limit estão dentro de limites razoáveis
 */
function validatePaginationLimits(req, res, next) {
  try {
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;

    // Validação de page
    if (page < 1 || isNaN(page)) {
      return res.status(400).json({
        error: 'Validation failed',
        details: { page: ['Page must be at least 1'] }
      });
    }

    // Validação de limit
    if (limit < 1 || isNaN(limit)) {
      return res.status(400).json({
        error: 'Validation failed',
        details: { limit: ['Limit must be at least 1'] }
      });
    }

    if (limit > 100) {
      logger.warn(`[Query Limit] Limit ${limit} exceeds max 100 - capped to 100`, {
        ip: req.ip,
        endpoint: req.path
      });
      req.query.limit = '100';
    }

    if (page > 10000) {
      logger.warn(`[Query Limit] Page ${page} exceeds max 10000`, {
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(400).json({
        error: 'Validation failed',
        details: { page: ['Page number too high (max 10000)'] }
      });
    }

    next();
  } catch (error) {
    logger.error('[Query Limit] Unexpected error in validatePaginationLimits');
    res.status(400).json({
      error: 'Invalid pagination parameters'
    });
  }
}

/**
 * Middleware para validar tamanho máximo de query string
 * Previne que alguém envie query strings gigantes
 */
function validateQuerySize(maxSize = 2048) {
  return (req, res, next) => {
    const queryString = JSON.stringify(req.query);
    if (queryString.length > maxSize) {
      logger.warn(`[Query Size] Query exceeds ${maxSize} bytes`, {
        size: queryString.length,
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(400).json({
        error: 'Query parameters too large',
        details: `Query string cannot exceed ${maxSize} bytes`
      });
    }
    next();
  };
}

module.exports = {
  validatePaginationLimits,
  validateQuerySize
};
