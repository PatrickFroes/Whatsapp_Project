/**
 * correlationId.middleware.js - Adiciona correlation ID único a cada requisição
 * Permite rastrear requisições através de múltiplos serviços
 */

/**
 * Middleware para adicionar Correlation ID
 * - Verificar header X-Correlation-ID existente
 * - Criar novo ID se não existir
 * - Passarpara o logger
 */
function correlationIdMiddleware(req, res, next) {
  // Verificar se já tem correlation ID no header
  const correlationId = req.headers['x-correlation-id'] || generateCorrelationId();

  // Store no request
  req.correlationId = correlationId;

  // Adicionar ao response header
  res.setHeader('X-Correlation-ID', correlationId);

  next();
}

/**
 * Gera um Correlation ID único
 * Formato: {timestamp}-{uuid}
 */
function generateCorrelationId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Log middleware com structured logging
 */
function structuredLoggingMiddleware(req, res, next) {
  const startTime = Date.now();

  // Middleware para capturar response
  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - startTime;

    const logData = {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
      tenantId: req.user?.tenantId
    };

    // Log em nível apropriado
    if (res.statusCode >= 500) {
      logger.error('[Request]', JSON.stringify(logData));
    } else if (res.statusCode >= 400) {
      logger.warn('[Request]', JSON.stringify(logData));
    } else {
      logger.debug('[Request]', JSON.stringify(logData));
    }

    return originalJson.call(this, data);
  };

  next();
}

module.exports = {
  correlationIdMiddleware,
  structuredLoggingMiddleware,
  generateCorrelationId
};
