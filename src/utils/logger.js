/**
 * Logger Condicional - Controla logs baseado no ambiente
 *
 * Em PRODUÇÃO: Logs são filtrados, informações sensíveis são mascaradas
 * Em DESENVOLVIMENTO: Logs completos para debugging
 */

const isProduction = process.env.NODE_ENV === 'production';

// Níveis de log
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Nível mínimo baseado no ambiente (produção = apenas WARN e ERROR)
const MIN_LEVEL = isProduction ? LOG_LEVELS.WARN : LOG_LEVELS.DEBUG;

/**
 * Mascara dados sensíveis em strings
 */
function maskSensitiveData(data) {
  if (!data) {
    return data;
  }

  let str = typeof data === 'string' ? data : JSON.stringify(data);

  // Mascara tokens
  str = str.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  str = str.replace(
    /(token|password|secret|authorization)['":\s]+[A-Za-z0-9\-._~+/]+/gi,
    '$1: [REDACTED]'
  );

  // Mascara emails parcialmente
  str = str.replace(
    /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    (match, user, domain) => {
      const maskedUser = user.substring(0, 2) + '***';
      return `${maskedUser}@${domain}`;
    }
  );

  // Mascara telefones parcialmente
  str = str.replace(
    /(\+?55)?[\s-]?\(?([0-9]{2})\)?[\s-]?([0-9]{4,5})[\s-]?([0-9]{4})/g,
    (match, country, ddd, p1, p2) => `${country || ''}${ddd}****${p2}`
  );

  return str;
}

/**
 * Logger principal
 */
const logger = {
  debug: (message, ...args) => {
    if (MIN_LEVEL <= LOG_LEVELS.DEBUG) {
      logger.debug(`[DEBUG] ${message}`, ...args);
    }
  },

  info: (message, ...args) => {
    if (MIN_LEVEL <= LOG_LEVELS.INFO) {
      const safeMessage = isProduction ? maskSensitiveData(message) : message;
      logger.debug(
        `[INFO] ${safeMessage}`,
        ...args.map((a) => (isProduction ? maskSensitiveData(a) : a))
      );
    }
  },

  warn: (message, ...args) => {
    if (MIN_LEVEL <= LOG_LEVELS.WARN) {
      logger.warn(`[WARN] ${message}`, ...args);
    }
  },

  error: (message, error = null) => {
    if (MIN_LEVEL <= LOG_LEVELS.ERROR) {
      // Em produção, não expõe stack traces completos
      if (isProduction) {
        logger.error(`[ERROR] ${message}`, error ? error.message : '');
      } else {
        logger.error(`[ERROR] ${message}`, error || '');
      }
    }
  },

  // Log de requisição HTTP (para debugging de APIs)
  http: (method, path, status, duration) => {
    if (!isProduction) {
      logger.debug(`[HTTP] ${method} ${path} - ${status} (${duration}ms)`);
    }
  },

  // Log específico para Socket.io
  socket: (event, data) => {
    if (!isProduction) {
      logger.debug(`[Socket] ${event}`, data ? JSON.stringify(data).substring(0, 100) : '');
    }
  },

  // Log específico para FlowEngine
  flow: (conversationId, message) => {
    if (!isProduction) {
      logger.debug(`[FlowEngine] Conv:${conversationId?.substring(0, 8) || '???'} - ${message}`);
    }
  }
};

module.exports = logger;
