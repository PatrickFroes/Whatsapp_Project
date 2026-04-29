// src/middleware/loginRateLimiter.js
// Rate limiter de login customizado que conta apenas falhas e rastreia por device

const crypto = require('crypto');
const logger = require('../utils/logger');

// Store em Redis (produção) ou memória (desenvolvimento)
let redisClient = null;
let redisConnecting = false;
const loginAttempts = new Map();

// Configurações
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);
const LOGIN_WINDOW_MINUTES = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || 5);
const WINDOW_MS = LOGIN_WINDOW_MINUTES * 60 * 1000;

/**
 * Conectar ao Redis - LAZY (não bloqueia startup)
 * Tenta conectar apenas quando necessário
 */
async function initRedis() {
  // Se já está conectando ou conectado, pular
  if (redisConnecting || redisClient?.isOpen) return;
  
  redisConnecting = true;
  
  try {
    const redis = require('redis');
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          // Max 5 tentativas, depois desiste (não consome recursos)
          if (retries > 5) {
            logger.warn('Redis: máximo de reconexões atingido, usando memória');
            return false;
          }
          return Math.min(retries * 100, 1000);
        },
        connectTimeout: 5000,
        keepAlive: 0
      }
    });
    
    redisClient.on('error', (err) => {
      if (err.code !== 'ECONNREFUSED') {
        logger.warn('Redis erro:', err.message);
      }
    });
    
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 5000))
    ]);
    
    logger.info('Redis conectado com sucesso');
  } catch (err) {
    logger.debug('Redis não disponível, usando memória:', err.message);
    redisClient = null;
  } finally {
    redisConnecting = false;
  }
}

/**
 * Gera um device ID único baseado em múltiplos headers
 * Identifica computador/navegador mesmo atrás de NAT/roteador/proxy
 * 
 * Utiliza:
 * - User-Agent (navegador/SO)
 * - Accept-Language (idioma do sistema)
 * - Accept-Encoding (suporte a compressão)
 * - Accept (tipos MIME suportados)
 * - Client IP real (X-Forwarded-For para proxies/containers)
 */
function generateDeviceId(req) {
  const userAgent = req.get('user-agent') || 'unknown';
  const acceptLanguage = req.get('accept-language') || 'unknown';
  const acceptEncoding = req.get('accept-encoding') || 'unknown';
  const accept = req.get('accept') || 'unknown';
  
  // Pegar IP real considerando proxies (X-Forwarded-For para container/nginx/lb)
  let clientIp = 'unknown';
  const xForwardedFor = req.get('x-forwarded-for');
  if (xForwardedFor) {
    clientIp = xForwardedFor.split(',')[0].trim();
  } else if (req.ip) {
    clientIp = req.ip;
  } else if (req.connection?.remoteAddress) {
    clientIp = req.connection.remoteAddress;
  } else if (req.socket?.remoteAddress) {
    clientIp = req.socket.remoteAddress;
  }
  
  // Fingerprint mais robusto do device
  const fingerprint = `${userAgent}|${acceptLanguage}|${acceptEncoding}|${accept}|${clientIp}`;
  const deviceId = crypto.createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);
  
  return deviceId;
}

async function checkLoginAttempts(req, res, next) {
  const deviceId = generateDeviceId(req);
  const key = `login_${deviceId}`; // Removido email do key (não expõe usuários)
  
  try {
    // Lazy connect ao Redis
    if (!redisClient?.isOpen && !redisConnecting && process.env.REDIS_URL) {
      await initRedis();
    }
    
    let attempt = null;
    
    if (redisClient?.isOpen) {
      try {
        const data = await redisClient.get(key);
        attempt = data ? JSON.parse(data) : null;
      } catch (redisErr) {
        // Se falhar Redis, usa memória
        attempt = loginAttempts.get(key);
      }
    } else {
      attempt = loginAttempts.get(key);
    }
    
    if (attempt && attempt.count >= LOGIN_MAX_ATTEMPTS) {
      const timeLeft = Math.ceil((attempt.timestamp + WINDOW_MS - Date.now()) / 1000);
      
      if (timeLeft > 0) {
        logger.warn('Login bloqueado - tentativas excedidas', {
          deviceId,
          attempts: attempt.count,
          retrySeconds: timeLeft
        });
        
        return res.status(429).json({
          error: 'Muitas tentativas de login. Tente novamente mais tarde.',
          retryAfterSeconds: timeLeft
        });
      } else {
        // Janela expirou, limpar
        if (redisClient?.isOpen) {
          await redisClient.del(key).catch(() => {});
        } else {
          loginAttempts.delete(key);
        }
      }
    }
    
    req.deviceId = deviceId;
    next();
  } catch (err) {
    logger.error('Erro ao verificar login attempts', { error: err.message });
    // Continua mesmo com erro - não bloqueia login
    req.deviceId = deviceId;
    next();
  }
}

/**
 * Recordar tentativa FALHADA de login
 * Usar APÓS verificar que a senha está incorreta
 */
async function recordFailedLogin(email, deviceId) {
  const key = `login_${deviceId}`;
  
  try {
    // Lazy connect ao Redis
    if (!redisClient?.isOpen && !redisConnecting && process.env.REDIS_URL) {
      await initRedis();
    }
    
    let attempt = null;
    
    if (redisClient?.isOpen) {
      try {
        const data = await redisClient.get(key);
        attempt = data ? JSON.parse(data) : null;
      } catch (redisErr) {
        attempt = loginAttempts.get(key);
      }
    } else {
      attempt = loginAttempts.get(key);
    }
    
    let newAttempt;
    if (attempt) {
      if (Date.now() - attempt.timestamp < WINDOW_MS) {
        attempt.count++;
        newAttempt = attempt;
      } else {
        newAttempt = { count: 1, timestamp: Date.now() };
      }
    } else {
      newAttempt = { count: 1, timestamp: Date.now() };
    }
    
    if (redisClient?.isOpen) {
      await redisClient.setEx(key, Math.ceil(WINDOW_MS / 1000), JSON.stringify(newAttempt)).catch(() => {});
    } else {
      loginAttempts.set(key, newAttempt);
    }
    
    if (newAttempt.count >= LOGIN_MAX_ATTEMPTS) {
      logger.warn('Limite de tentativas atingido', { deviceId });
    }
  } catch (err) {
    logger.error('Erro ao registrar login falho', { error: err.message });
  }
}

/**
 * Limpar tentativas ao login bem-sucedido
 * Usar APÓS login bem-sucedido
 */
async function clearLoginAttempts(email, deviceId) {
  const key = `login_${deviceId}`;
  
  try {
    if (redisClient?.isOpen) {
      await redisClient.del(key).catch(() => {});
    } else {
      loginAttempts.delete(key);
    }
  } catch (err) {
    logger.error('Erro ao limpar login attempts', { error: err.message });
  }
}

/**
 * Limpeza periódica de entradas antigas (apenas em memória)
 * Redis gerencia TTL automaticamente
 * Executa a cada 30 minutos (menos overhead)
 */
setInterval(() => {
  if (!redisClient?.isOpen && loginAttempts.size > 0) {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, attempt] of loginAttempts.entries()) {
      if (now - attempt.timestamp > WINDOW_MS) {
        loginAttempts.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug('Limpeza de login attempts', { removed: cleaned, remaining: loginAttempts.size });
    }
  }
}, 30 * 60 * 1000);

module.exports = {
  checkLoginAttempts,
  recordFailedLogin,
  clearLoginAttempts,
  generateDeviceId
};
