const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const prisma = require('./database');

let io;

function handleSocketConnection(socket, prismaClient = prisma) {
  const { userId, tenantId } = socket.user;
  logger.socket('connect', `${socket.id} (user: ${userId}, tenant: ${tenantId})`);

  // Auto-join no room do tenant e do usuário (baseado no token)
  socket.join(`tenant:${tenantId}`);
  socket.join(`user:${userId}`);

  // Join tenant room — validar que pertence ao tenant do token
  socket.on('join_tenant', (requestedTenantId) => {
    if (requestedTenantId !== tenantId) {
      logger.warn(`[Socket] Acesso negado: user ${userId} tentou join em tenant ${requestedTenantId}`);
      socket.emit('join_denied', { scope: 'tenant', requestedTenantId });
      return;
    }
    // Já fez join automático acima, mas mantém compatibilidade
    socket.join(`tenant:${tenantId}`);
  });

  // Join user room — só pode entrar na própria sala
  socket.on('join_user', (requestedUserId) => {
    if (requestedUserId !== userId) {
      logger.warn(`[Socket] Acesso negado: user ${userId} tentou join como ${requestedUserId}`);
      socket.emit('join_denied', { scope: 'user', requestedUserId });
      return;
    }
    socket.join(`user:${userId}`);
  });

  // Join conversation room (validação de tenant — impede acesso cross-tenant)
  socket.on('join_conversation', async (conversationId) => {
    try {
      const conv = await prismaClient.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true }
      });
      if (!conv) {
        logger.warn(
          `[Socket] Acesso negado: user ${userId} tentou join conversa ${conversationId} de outro tenant`
        );
        socket.emit('join_denied', { scope: 'conversation', conversationId });
        return;
      }
      logger.socket('join_conversation', `${conversationId} (by ${userId})`);
      socket.join(`conversation:${conversationId}`);
    } catch (err) {
      logger.error('[Socket] Erro ao validar join_conversation:', err.message);
      socket.emit('join_denied', { scope: 'conversation', conversationId, reason: 'validation_error' });
    }
  });

  // Leave conversation room
  socket.on('leave_conversation', (conversationId) => {
    logger.socket('leave_conversation', conversationId);
    socket.leave(`conversation:${conversationId}`);
  });
}

async function init(httpServer, corsConfig) {
  if (io) {
    return io;
  }

  io = new Server(httpServer, {
    cors: corsConfig || { origin: '*' }
  });

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => logger.warn('[Redis] Pub Client Error', err.message));
    subClient.on('error', (err) => logger.warn('[Redis] Sub Client Error', err.message));

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    logger.info('[Socket] Redis Adapter attached');
  } catch (e) {
    logger.warn('[Socket] WARNING: Redis not found. Running in local memory mode.');
  }

  // ====== AUTENTICAÇÃO JWT NO SOCKET.IO ======
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Autenticação necessária'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = {
        userId: decoded.userId,
        tenantId: decoded.tenantId,
        role: decoded.role
      };
      next();
    } catch (err) {
      logger.warn(`[Socket] Token inválido: ${err.message}`);
      return next(new Error('Token inválido ou expirado'));
    }
  });

  io.on('connection', (socket) => handleSocketConnection(socket, prisma));

  logger.info('[Socket] Initialized singleton.');
  return io;
}

function getIO() {
  return io;
}

module.exports = {
  init,
  getIO,
  handleSocketConnection
};
