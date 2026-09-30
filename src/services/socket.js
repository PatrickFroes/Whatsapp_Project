const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const prisma = require('./database');
const { decrypt, hashString, isIpCompatible } = require('../utils/crypto');

let io;

function handleSocketConnection(socket, prismaClient = prisma) {
  const { userId, tenantId } = socket.user;
  const token = socket.token;
  logger.socket('connect', `${socket.id} (user: ${userId}, tenant: ${tenantId})`);

  // Auto-join no room do tenant e do usuário (baseado no token)
  socket.join(`tenant:${tenantId}`);
  socket.join(`user:${userId}`);

  // 🛡️ Registra a sessão ativa no banco de dados
  if (token) {
    prismaClient.userSession.upsert({
      where: { token },
      update: { updatedAt: new Date() },
      create: {
        userId,
        tenantId,
        role: socket.user.role,
        token
      }
    }).catch(err => logger.error('[Socket] Erro ao registrar UserSession:', err.message));
  }

  // Heartbeat do front-end para manter a sessão ativa
  socket.on('heartbeat', () => {
    if (token) {
      prismaClient.userSession.update({
        where: { token },
        data: { updatedAt: new Date() }
      }).catch(() => {});
    }
  });

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

  // Evento de desconexão
  socket.on('disconnect', async () => {
    logger.socket('disconnect', `${socket.id} (user: ${userId}, tenant: ${tenantId})`);

    // 🛡️ Remove a sessão do banco de dados de forma assíncrona
    if (token) {
      prismaClient.userSession.delete({
        where: { token }
      }).catch(() => {});
    }
    
    // Cooldown de 10 segundos para evitar definir como offline na atualização de página
    setTimeout(async () => {
      try {
        const userSockets = await io.in(`user:${userId}`).fetchSockets();
        if (userSockets.length === 0) {
          logger.info(`[Socket] Usuário ${userId} desconectou de todas as abas. Verificando atendimentos para offline automático.`);
          const AgentStatusService = require('./AgentStatusService');
          
          const activeChatsCount = await prisma.conversation.count({
            where: {
              assignedToId: userId,
              status: { in: ['ASSIGNED', 'QUEUED'] }
            }
          });

          if (activeChatsCount === 0) {
            await AgentStatusService.updateStatus(userId, 'OFFLINE', 'Desconexão de Socket', tenantId);
          } else {
            logger.info(`[Socket] Usuário ${userId} desconectou o socket com ${activeChatsCount} chats ativos. Agendando offline pendente.`);
            await AgentStatusService.updateStatus(userId, 'OFFLINE', 'Desconexão com chats ativos', tenantId);
          }
        } else {
          logger.info(`[Socket] Usuário ${userId} desconectou uma aba, mas ainda possui ${userSockets.length} conexões ativas.`);
        }
      } catch (err) {
        logger.error(`[Socket] Erro ao processar desconexão automática do usuário ${userId}:`, err.message);
      }
    }, 10000);
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
  const isRediss = redisUrl.startsWith('rediss://');

  try {
    const redisOptions = {
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 30) {
            logger.warn('[Socket Redis] Limite de 30 reconexões excedido. Abortando.');
            return new Error('Redis connection failed');
          }
          // Backoff exponencial: 100ms, 200ms, 400ms, 800ms... max 2000ms
          return Math.min(100 * Math.pow(2, retries - 1), 2000);
        }
      }
    };
    if (isRediss) {
      redisOptions.socket.tls = true;
      redisOptions.socket.rejectUnauthorized = false;
    }
    const pubClient = createClient(redisOptions);
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => logger.warn('[Redis] Pub Client Error', err.message));
    subClient.on('error', (err) => logger.warn('[Redis] Sub Client Error', err.message));

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    logger.info('[Socket] Redis Adapter attached');
  } catch (e) {
    logger.warn(`[Socket] WARNING: Redis not found. Running in local memory mode. Detalhes: ${e.message}`);
  }

  // ====== AUTENTICAÇÃO JWT NO SOCKET.IO ======
  io.of('/').use((socket, next) => {
    let token = socket.handshake.auth?.token;
    
    // Fallback: se não veio por auth, lê do cookie HttpOnly do handshake e decripta se necessário
    if (!token && socket.handshake.headers.cookie) {
      const match = socket.handshake.headers.cookie.match(/auth_token=([^;]+)/);
      if (match) {
        const cookieVal = match[1];
        const decrypted = decrypt(cookieVal);
        token = decrypted || cookieVal;
      }
    }

    if (!token) {
      return next(new Error('Autenticação necessária'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 🛡️ Segurança Adicional: Validação de User-Agent e IP contra sequestro de sessão
      const userAgent = socket.handshake.headers['user-agent'] || '';
      const currentUaHash = hashString(userAgent);
      const currentIp = socket.handshake.address || socket.handshake.headers['x-forwarded-for'] || '';

      if (decoded.uaHash && decoded.uaHash !== currentUaHash) {
        logger.warn('[Socket] Connection Rejected (User-Agent mismatch)', {
          userId: decoded.userId,
          expected: decoded.uaHash,
          actual: currentUaHash
        });
        return next(new Error('Dispositivo de origem inválido'));
      }



      socket.user = {
        userId: decoded.userId,
        tenantId: decoded.tenantId,
        role: decoded.role
      };
      socket.token = token;
      next();
    } catch (err) {
      logger.warn(`[Socket] Token inválido: ${err.message}`);
      return next(new Error('Token inválido ou expirado'));
    }
  });

  io.on('connection', (socket) => handleSocketConnection(socket, prisma));

  // ====== NAMESPACE DO WEBCHAT (VISITANTES PÚBLICOS) ======
  const webchatNamespace = io.of('/webchat');
  const WebchatSocketService = require('./WebchatSocketService');
  WebchatSocketService.init(webchatNamespace);

  logger.info('[Socket] Initialized singleton with Webchat namespace.');
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
