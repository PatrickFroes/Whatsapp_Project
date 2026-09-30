const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { decrypt, hashString, isIpCompatible } = require('../utils/crypto');

if (!process.env.JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET environment variable is required!');
  process.exit(1);
}

const SECRET_KEY = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Se o token for nulo, indefinido ou string 'null'/'undefined', tratamos como inexistente
  if (!token || token === 'null' || token === 'undefined') {
    token = null;
  }

  // Fallback: se não veio no header, lê do cookie HttpOnly e decripta
  if (!token && req.cookies && req.cookies.auth_token) {
    token = decrypt(req.cookies.auth_token);
  }

  // Fallback: lê de query parameters (necessário para tags HTML5 de mídia de áudio/vídeo/imagem)
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.sendStatus(403);
    }

    // 🛡️ Segurança Adicional: Validação de User-Agent e IP contra sequestro de sessão
    const userAgent = req.headers['user-agent'] || '';
    const currentUaHash = hashString(userAgent);
    const currentIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

    if (decoded.uaHash && decoded.uaHash !== currentUaHash) {
      logger.warn('[AUTH] Session Hijack Attempt Detected (User-Agent mismatch)', {
        userId: decoded.userId,
        expectedHash: decoded.uaHash,
        actualHash: currentUaHash,
        ip: currentIp
      });
      return res.sendStatus(401);
    }



    // Attach user info to request
    req.user = decoded;
    // decoded contains { userId, tenantId, role }
    req.tenantId = decoded.tenantId; // convenience

    next();
  });
};

const authorizeRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.sendStatus(401);
    }
    if (!roles.includes(req.user.role)) {
      logger.warn('[AUTH] Access denied — insufficient role', {
        userId: req.user.userId,
        role: req.user.role,
        requiredRoles: roles,
        route: req.originalUrl,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRole };
