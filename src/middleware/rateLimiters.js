/**
 * RateLimiters.js - Configuradores de rate limit com base no tipo de operação
 *
 * Diferentes endpoints requerem diferentes estratégias de rate limiting
 * baseado em críticidade de segurança, frequência normal de uso, etc
 */

const rateLimit = require('express-rate-limit');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const LOGIN_WINDOW_MINUTES = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || 5);
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);

// NOTE: Login rate limiting is now handled by custom middleware (loginRateLimiter.js)
// which uses per-device fingerprinting instead of global IP-based limiting.
// This prevents legitimate logins from being blocked and only counts failed attempts.

/**
 * Registration Rate Limiter
 * Previne account creation spam
 * 3 registros por hora por IP
 */
const registrationLimiter = rateLimit({
  windowMs: HOUR_MS,
  max: 3,
  message: {
    error: 'Too many accounts created from this IP. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * API General Rate Limiter - Padrão para endpoints normais
 * 300 requisições por minuto por IP
 * Protege contra DDoS simples, mas permite uso normal
 */
const apiLimiter = rateLimit({
  windowMs: MINUTE_MS,
  max: 300,
  message: {
    error: 'Too many requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Webhook Rate Limiter - Menos restritivo (para mass messaging)
 * WhatsApp envia webhooks em alta frequência
 * 1000 eventos por minuto por tenant
 */
const webhookLimiter = rateLimit({
  windowMs: MINUTE_MS,
  max: 1000,
  message: {
    error: 'Webhook rate limit exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Message Send Rate Limiter
 * Protege contra spam de mensagens
 * 100 mensagens por minuto por agent
 */
const messageSendLimiter = rateLimit({
  windowMs: MINUTE_MS,
  max: 100,
  message: {
    error: 'Message rate limit exceeded. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Media Upload Rate Limiter
 * Protege armazenamento de upload spam
 * 50 uploads por hora por IP
 */
const mediaUploadLimiter = rateLimit({
  windowMs: HOUR_MS,
  max: 50,
  message: {
    error: 'Media upload limit exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Admin API Rate Limiter - Muito permissivo para admin areas
 * 5000 requisições por minuto por admin
 * Admin operations são críticas e precisam ser rápidas
 */
const adminLimiter = rateLimit({
  windowMs: MINUTE_MS,
  max: 5000,
  message: {
    error: 'Admin rate limit exceeded (very high threshold)'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Password Reset Rate Limiter
 * Previne ataques de reset password spam
 * 3 tentativas por hora por email/IP
 */
const passwordResetLimiter = rateLimit({
  windowMs: HOUR_MS,
  max: 3,
  message: {
    error: 'Too many password reset requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Export all limiters for use in routes
 * Note: loginLimiter removed - use custom middleware checkLoginAttempts instead
 */
module.exports = {
  registrationLimiter,
  apiLimiter,
  webhookLimiter,
  messageSendLimiter,
  mediaUploadLimiter,
  adminLimiter,
  passwordResetLimiter
};
