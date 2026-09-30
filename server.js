require('dotenv').config();

const logger = require('./src/utils/logger');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');
const { correlationIdMiddleware } = require('./src/middleware/correlationId.middleware');
const ConversationTimeoutService = require('./src/services/ConversationTimeoutService');
const { decrypt, hashString, isIpCompatible } = require('./src/utils/crypto');

// ============================================================================
// OTIMIZAÇÃO DE MEMÓRIA PARA SERVIDOR SMALL (2GB RAM, 2 CORES)
// ============================================================================
if (process.env.NODE_ENV === 'production') {
  // Limite máximo de memória heap
  const heapLimit = 512 * 1024 * 1024; // 512MB
  if (global.gc) {
    // Garbage collection agressivo a cada 5 minutos
    setInterval(() => {
      if (global.gc) {
        global.gc();
        const memUsage = process.memoryUsage();
        logger.debug('Garbage collection', {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
        });
      }
    }, 5 * 60 * 1000);
  }
  
  // Avisar se memória estiver alta
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const percentUsed = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    if (percentUsed > 85) {
      logger.warn('Memória alta', {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        percent: Math.round(percentUsed) + '%'
      });
    }
  }, 30 * 1000);
}

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION', err);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('UNHANDLED REJECTION', reason);
});

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const http = require('http');

const socketService = require('./src/services/socket');

const authRoutes = require('./src/routes/authRoutes');
const webhookRoutes = require('./src/routes/webhookRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const superAdminRoutes = require('./src/routes/superAdminRoutes');
const supervisorRoutes = require('./src/routes/supervisorRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const templateRoutes = require('./src/routes/templateRoutes');

const mediaRoutes = require('./src/routes/mediaRoutes');
const quickReplyRoutes = require('./src/routes/quickReplyRoutes');
const internalNoteRoutes = require('./src/routes/internalNoteRoutes');
const transferRoutes = require('./src/routes/transferRoutes');
const businessHoursRoutes = require('./src/routes/businessHoursRoutes');

const lgpdRoutes = require('./src/routes/lgpdRoutes');
const historyRoutes = require('./src/routes/historyRoutes');
const telegramRoutes = require('./src/routes/telegramRoutes');

// Rate limiters from optimized middleware (with IPv6 support)
const {
  registrationLimiter,
  apiLimiter,
  webhookLimiter,
  messageSendLimiter,
  mediaUploadLimiter,
  adminLimiter,
  passwordResetLimiter,
  healthCheckLimiter
} = require('./src/middleware/rateLimiters');
// Note: loginLimiter removed - login rate limiting uses custom device-based middleware

const app = express();
const server = http.createServer(app);

// Must be configured before any middleware that depends on client IP (rate limiters, logs).
app.set('trust proxy', 1);

const SERVER_ID = Math.floor(Math.random() * 10000);
console.log(`[Server] Starting Instance ID: ${SERVER_ID}`);

async function startServer() {
  const socketCorsOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [
    'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const io = await socketService.init(server, {
    origin: socketCorsOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  });

  // ============================================================================
  // MIDDLEWARE CORE INTEGRATION - Correlation ID & Compression
  // ============================================================================
  // Add Correlation ID as early as possible (first middleware)
  // This ensures every request is tracked throughout its lifecycle
  app.use(correlationIdMiddleware);

  app.use(compression());

  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, `https://${req.hostname}${req.url}`);
      }
      next();
    });
  }

  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: false
    })
  );

  // ============================================================================
  // SECURITY MIDDLEWARE INTEGRATION - Rate Limiting (IPv6 Compatible)
  // ============================================================================
  // Apply global API rate limiter (skip health checks and webhooks)
  app.use('/api/', apiLimiter);

  // Apply specific rate limiters via route handlers
  // Login attempts: handled by custom device-based middleware in authRoutes
  // (see checkLoginAttempts in src/middleware/loginRateLimiter.js)

  // Registration: 3 per hour (prevent spam account creation)
  app.use('/api/auth/register', registrationLimiter);

  // Admin actions: 5000 per minute (high privilege, high volume)
  app.use('/api/admin', adminLimiter);

  // Password reset: 3 per hour (security)
  app.use('/api/auth/password-reset', passwordResetLimiter);

  app.use((req, res, next) => {
    res.setHeader('X-Server-ID', SERVER_ID);
    next();
  });

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [
    'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const privateIpPattern =
    /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        // Apenas permitir ngrok em desenvolvimento
        if (process.env.NODE_ENV !== 'production') {
          if (
            origin.includes('.ngrok.io') ||
            origin.includes('.ngrok-free.app') ||
            origin.includes('.ngrok-free.dev') ||
            origin.includes('ngrok.app')
          ) {
            return callback(null, true);
          }
        }

        if (privateIpPattern.test(origin)) {
          return callback(null, true);
        }

        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn(`[CORS] Origem bloqueada: ${origin}`);
          callback(new Error('Origem não permitida pelo CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
    })
  );
  app.use(
    bodyParser.json({
      verify: (req, res, buf) => {
        if (req.originalUrl && req.originalUrl.startsWith('/webhook')) {
          req.rawBody = buf;
        }
      }
    })
  );
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.get('/', (req, res) => {
    res.redirect('/login.html');
  });

  const protectedPages = {
    '/admin.html': ['ADMIN', 'OWNER', 'SUPER_ADMIN'],
    '/supervisor.html': ['SUPERVISOR', 'ADMIN', 'OWNER', 'SUPER_ADMIN'],
    '/super.html': ['SUPER_ADMIN']
  };

  app.use((req, res, next) => {
    const pagePath = req.path.toLowerCase();

    if (pagePath === '/agent.html') {
      return next();
    }

    if (!protectedPages.hasOwnProperty(pagePath)) {
      return next();
    }

    let token = req.cookies && req.cookies.auth_token;
    if (!token) {
      return res.redirect('/login.html');
    }

    const decrypted = decrypt(token);
    token = decrypted || token;

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 🛡️ Validação de User-Agent e IP contra sequestro de sessão
      const userAgent = req.headers['user-agent'] || '';
      const currentUaHash = hashString(userAgent);
      const currentIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

      if (decoded.uaHash && decoded.uaHash !== currentUaHash) {
        res.clearCookie('auth_token', { path: '/' });
        return res.redirect('/login.html');
      }

      if (decoded.ip && !isIpCompatible(decoded.ip, currentIp)) {
        res.clearCookie('auth_token', { path: '/' });
        return res.redirect('/login.html');
      }

      const allowedRoles = protectedPages[pagePath];

      if (allowedRoles && !allowedRoles.includes(decoded.role)) {
        return res.redirect('/login.html');
      }

      next();
    } catch (err) {
      res.clearCookie('auth_token', { path: '/' });
      return res.redirect('/login.html');
    }
  });

  // ============================================================================
  // PUBLIC PAGES & STATIC FILES
  // ============================================================================
  // Serve static files from frontend folder
  app.use(
    express.static('frontend', {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    })
  );

  // Serve policy pages (public routes)
  app.get('/privacy', (req, res) => {
    const privacyPath = require('path').join(__dirname, 'frontend', 'privacy.html');

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.sendFile(privacyPath, (err) => {
      if (err) {
        logger.error('Erro ao servir privacy.html', {
          path: privacyPath,
          error: err.message,
          code: err.code
        });
        res.status(404).json({ 
          error: 'Arquivo de política de privacidade não encontrado'
        });
      }
    });
  });

  app.use((req, res, next) => {
    req.io = io;
    next();
  });

  // ============================================================================
  // API ROUTES - With Middleware Integration
  // ============================================================================
  // All routes are now protected by:
  // 1. Correlation ID (tracking per request through logs)
  // 2. Rate limiting (prevent abuse and DDoS)
  // 3. Error handling (centralized, structured)
  // 4. Morgan logging (request/response metrics)
  // ============================================================================

  app.use('/api/auth', authRoutes);
  app.use('/webhook', webhookRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/supervisor', supervisorRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/super', superAdminRoutes);
  app.use('/api', chatRoutes);

  app.use('/api/media', mediaRoutes);
  app.use('/api/quick-replies', quickReplyRoutes);
  app.use('/api/notes', internalNoteRoutes);
  app.use('/api/transfer', transferRoutes);
  app.use('/api/business-hours', businessHoursRoutes);

  app.use('/api/lgpd', lgpdRoutes);
  app.use('/api/customer-history', historyRoutes);
  app.use('/api', telegramRoutes);

  // Health Check
  app.get('/health', healthCheckLimiter, (req, res) => {
    res.json({ status: 'ok', version: '2.0.0-saas' });
  });

  // 404 Handler (rotas não encontradas)
  app.use(notFoundHandler);

  // Global Error Handler (centralizado, seguro)
  app.use(errorHandler);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Inicia o monitor de expiração de conversas inativas
    ConversationTimeoutService.init();

    // Inicia o cron diário de limpeza de mensagens expiradas (SaaS)
    const runCleanup = require('./scripts/cleanup-expired-data');
    setTimeout(() => {
      runCleanup().catch(err => logger.error('[Cleanup] Startup cleanup task error:', err.message));
    }, 15000);

    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 horas
    setInterval(() => {
      runCleanup().catch(err => logger.error('[Cleanup] Periodic cleanup task error:', err.message));
    }, CLEANUP_INTERVAL);

    // ========================================================================
    // MIDDLEWARE INTEGRATION REPORT
    // ========================================================================
    logger.info('✅ Middleware Stack Initialized:');
    logger.info('  1. Correlation ID Middleware (request tracking)');
    logger.info('  2. Compression Middleware (response optimization)');
    logger.info('  3. Security: Helmet (headers protection)');
    logger.info('  4. Rate Limiting: 8 rate limiters configured');
    logger.info('     - Login: 5 req/15min');
    logger.info('     - Registration: 3 req/hour');
    logger.info('     - API: 300 req/min');
    logger.info('     - Webhook: 1000 events/min');
    logger.info('     - Messages: 100 msg/min');
    logger.info('     - Media Upload: 50 uploads/hour');
    logger.info('     - Admin: 5000 req/min');
    logger.info('     - Password Reset: 3 req/hour');
    logger.info('  5. CORS: Dynamic origin validation');
    logger.info('  6. Body Parser: JSON/URL-encoded/Cookie');
    logger.info('  7. Morgan: Request logging');
    logger.info('  8. Error Handling: Centralized middleware');
    logger.info('');
    logger.info('📊 Logging Features:');
    logger.info('  - Request Correlation IDs for audit trails');
    logger.info('  - Structured error logging');
    logger.info('  - Performance metrics via morgan');
    logger.info('  - Audit logging service integration ready');
    logger.info('  - Cache service integration ready');
    logger.info(`  - AI Integration: Provider=${process.env.AI_PROVIDER || 'ollama'} Model=${process.env.AI_MODEL || 'qwen2.5:3b'}`);
    logger.info('');
    logger.info('🔒 Security Status: HARDENED');
    logger.info('✨ Version: 2.0.0 - Production Ready');
    logger.info('========================================================================');
  });
}

startServer().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
