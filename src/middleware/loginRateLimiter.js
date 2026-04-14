// src/middleware/loginRateLimiter.js
// Rate limiter de login customizado que conta apenas falhas e rastreia por device

const crypto = require('crypto');

// Store em memória (em produção, use Redis)
const loginAttempts = new Map();

// Configurações
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);
const LOGIN_WINDOW_MINUTES = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || 5);
const WINDOW_MS = LOGIN_WINDOW_MINUTES * 60 * 1000;

/**
 * Gera um device ID único baseado no user-agent e outros headers
 * Isso identifica o computador/navegador ao invés de IP
 */
function generateDeviceId(req) {
  const userAgent = req.get('user-agent') || 'unknown';
  const acceptLanguage = req.get('accept-language') || 'unknown';
  const acceptEncoding = req.get('accept-encoding') || 'unknown';
  
  // Fingerprint do device
  const fingerprint = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
  const deviceId = crypto.createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);
  
  return deviceId;
}

/**
 * Middleware para VERIFICAR se o device está bloqueado
 * Usar ANTES de processar o login
 */
function checkLoginAttempts(req, res, next) {
  const deviceId = generateDeviceId(req);
  const email = req.body.email || 'unknown';
  const key = `login_${email}_${deviceId}`;
  
  const attempt = loginAttempts.get(key);
  
  if (attempt && attempt.count >= LOGIN_MAX_ATTEMPTS) {
    const timeLeft = Math.ceil((attempt.timestamp + WINDOW_MS - Date.now()) / 1000);
    
    if (timeLeft > 0) {
      console.log(`[LOGIN BLOQUEADO] ${email} - Tentativas excedidas. Retry em ${timeLeft}s`);
      
      return res.status(429).json({
        error: 'Muitas tentativas de login. Tente novamente mais tarde.',
        retryAfter: Math.ceil(timeLeft / 60), // em minutos
        retryAfterSeconds: timeLeft
      });
    } else {
      // Janela expirou, limpar tentativas
      loginAttempts.delete(key);
    }
  }
  
  // Armazenar deviceId para uso posterior
  req.deviceId = deviceId;
  next();
}

/**
 * Recordar tentativa FALHADA de login
 * Usar APÓS verificar que a senha está incorreta
 */
function recordFailedLogin(email, deviceId) {
  const key = `login_${email}_${deviceId}`;
  const attempt = loginAttempts.get(key);
  
  if (attempt) {
    // Se ainda está na janela, incrementar contador
    if (Date.now() - attempt.timestamp < WINDOW_MS) {
      attempt.count++;
      console.log(`[LOGIN FALHA] ${email} - Tentativa ${attempt.count}/${LOGIN_MAX_ATTEMPTS}`);
    } else {
      // Janela expirou, resetar
      loginAttempts.set(key, { count: 1, timestamp: Date.now() });
      console.log(`[LOGIN FALHA] ${email} - Janela resetada`);
    }
  } else {
    // Primeira tentativa
    loginAttempts.set(key, { count: 1, timestamp: Date.now() });
    console.log(`[LOGIN FALHA] ${email} - Primeira tentativa registrada`);
  }
}

/**
 * Limpar tentativas ao login bem-sucedido
 * Usar APÓS login bem-sucedido
 */
function clearLoginAttempts(email, deviceId) {
  const key = `login_${email}_${deviceId}`;
  loginAttempts.delete(key);
  console.log(`[LOGIN SUCESSO] ${email} - Tentativas limpas`);
}

/**
 * Limpeza periódica de entradas antigas
 * Executa a cada 10 minutos
 */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, attempt] of loginAttempts.entries()) {
    if (now - attempt.timestamp > WINDOW_MS) {
      loginAttempts.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[CLEANUP] Removidas ${cleaned} entradas antigas de login attempts`);
  }
}, 10 * 60 * 1000);

module.exports = {
  checkLoginAttempts,
  recordFailedLogin,
  clearLoginAttempts,
  generateDeviceId
};
