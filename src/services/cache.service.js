/**
 * cache.service.js - Serviço de caching com Redis
 * Melhora performance de queries frequentes
 */

const redis = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

/**
 * Inicializar Redis client
 */
async function initializeRedis() {
  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_DB || 0,
      password: process.env.REDIS_PASSWORD || undefined,
      connectTimeout: 5000,
      maxRetriesPerRequest: null
    });

    redisClient.on('error', (err) => {
      logger.error('[Cache] Redis error:', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('[Cache] Redis connected');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.error('[Cache] Failed to initialize Redis', { error: error.message });
    return null;
  }
}

/**
 * Keys de cache - constantes para evitar typos
 */
const CacheKeys = {
  USER: (userId) => `user:${userId}`,
  TENANT: (tenantId) => `tenant:${tenantId}`,
  CONVERSATION: (conversationId) => `conversation:${conversationId}`,
  SKILLS: (tenantId) => `skills:${tenantId}`,
  BUSINESS_HOURS: (tenantId) => `business_hours:${tenantId}`,
  TEMPLATES: (tenantId) => `templates:${tenantId}`
};

/**
 * Get valor do cache
 */
async function get(key) {
  if (!redisClient) {
    return null;
  }

  try {
    const value = await redisClient.get(key);
    if (value) {
      logger.debug(`[Cache] HIT: ${key}`);
      return JSON.parse(value);
    }
    logger.debug(`[Cache] MISS: ${key}`);
    return null;
  } catch (error) {
    logger.error('[Cache] Error getting key', { error: error.message, key });
    return null;
  }
}

/**
 * Set valor no cache
 */
async function set(key, value, ttlSeconds = 3600) {
  if (!redisClient) {
    return false;
  }

  try {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    logger.debug(`[Cache] SET: ${key} (TTL: ${ttlSeconds}s)`);
    return true;
  } catch (error) {
    logger.error('[Cache] Error setting key', { error: error.message, key });
    return false;
  }
}

/**
 * Delete valor do cache
 */
async function del(key) {
  if (!redisClient) {
    return false;
  }

  try {
    await redisClient.del(key);
    logger.debug(`[Cache] DEL: ${key}`);
    return true;
  } catch (error) {
    logger.error('[Cache] Error deleting key', { error: error.message, key });
    return false;
  }
}

/**
 * Invalidate múltiplas chaves com padrão
 */
async function invalidatePattern(pattern) {
  if (!redisClient) {
    return false;
  }

  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
      logger.info(`[Cache] Invalidated ${keys.length} keys matching pattern: ${pattern}`);
    }
    return true;
  } catch (error) {
    logger.error('[Cache] Error invalidating pattern', { error: error.message, pattern });
    return false;
  }
}

module.exports = {
  initializeRedis,
  get,
  set,
  del,
  invalidatePattern,
  CacheKeys
};
