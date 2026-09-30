/**
 * WebchatSocketService.js - Motor WebSocket de tempo real para visitantes do Webchat
 */

const logger = require('../utils/logger');
const prisma = require('./database');
const FlowEngine = require('./FlowEngine');

let nsp; // Namespace do Socket.io (/webchat)

class WebchatSocketService {
  /**
   * Inicializa o namespace do Socket.io para o Webchat
   */
  static init(webchatNamespace) {
    nsp = webchatNamespace;
    logger.info('[WebchatSocketService] Namespace /webchat inicializado.');

    // Middleware de validação do Token de Conexão pública do Webchat
    nsp.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) {
          return next(new Error('Conexão necessita de um Token público válido.'));
        }

        const connection = await prisma.webchatConnection.findUnique({
          where: { token }
        });

        if (!connection || connection.status !== 'CONNECTED') {
          return next(new Error('Conexão Webchat não encontrada ou desativada.'));
        }

        // Vincular conexões ao socket
        socket.webchatConnection = connection;
        socket.tenantId = connection.tenantId;
        next();
      } catch (err) {
        logger.error('[WebchatSocketService] Middleware error:', err);
        return next(new Error('Falha na validação da conexão.'));
      }
    });

    nsp.on('connection', (socket) => {
      const { tenantId, webchatConnection } = socket;
      const visitorId = socket.handshake.auth?.visitorId || socket.handshake.query?.visitorId;
      
      if (!visitorId) {
        logger.warn('[WebchatSocketService] Visitante conectado sem visitorId.');
        socket.disconnect();
        return;
      }

      logger.socket('webchat connect', `Visitante ${visitorId} conectado ao canal [${webchatConnection.name}]`);

      // Evento de inicializar o chat (join ou criação de conversa)
      socket.on('join_chat', async (callback) => {
        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          
          // 1. Procurar contato correspondente ao visitorId
          let contact = await prisma.contact.findFirst({
            where: { tenantId, phone: visitorId }
          });

          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                tenantId,
                phone: visitorId,
                name: `Visitante Webchat (${visitorId.substring(0, 6)})`
              }
            });
          }

          // 2. Procurar conversa ativa (BOT, ASSIGNED, QUEUED)
          let conversation = await prisma.conversation.findFirst({
            where: {
              tenantId,
              contactId: contact.id,
              status: { notIn: ['RESOLVED', 'CLOSED'] }
            }
          });

          let isNew = false;

          if (!conversation) {
            isNew = true;
            // Inicializar flowState
            const initialFlowState = {
              currentFlowId: webchatConnection.flowId || null,
              nodeId: 'start',
              step: 0,
              data: {},
              history: []
            };

            // Criar nova conversa de Webchat
            conversation = await prisma.conversation.create({
              data: {
                tenantId,
                contactId: contact.id,
                status: 'BOT',
                initiationType: 'INBOUND',
                channel: 'WEBCHAT',
                webchatConnectionId: webchatConnection.id,
                flowState: initialFlowState
              }
            });
          }

          // Associar o socket à sala da conversa imediatamente!
          socket.join(conversation.id);

          if (isNew) {
            // Disparar fluxo da URA inicial (passando message = null)
            logger.info(`[WebchatSocketService] Iniciando URA para nova conversa ${conversation.id}`);
            await FlowEngine.process(tenant, conversation, null);
          }

          // Buscar histórico de mensagens unificado (incluindo as mensagens geradas pela URA se for nova!)
          const messages = await prisma.message.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'asc' },
            take: 30
          });

          if (typeof callback === 'function') {
            callback({
              success: true,
              conversationId: conversation.id,
              messages: messages.map(m => ({
                id: m.id,
                content: m.content,
                contentType: m.contentType,
                direction: m.direction,
                createdAt: m.createdAt
              }))
            });
          }
        } catch (err) {
          logger.error('[WebchatSocketService] join_chat error:', err);
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Falha ao inicializar o chat.' });
          }
        }
      });

      // Evento de envio de mensagem do cliente
      socket.on('send_message', async (data, callback) => {
        try {
          const { conversationId, text } = data;
          if (!conversationId || !text || text.trim() === '') {
            return callback && callback({ success: false, error: 'Dados inválidos' });
          }

          const conversation = await prisma.conversation.findFirst({
            where: { id: conversationId, tenantId }
          });

          if (!conversation) {
            return callback && callback({ success: false, error: 'Conversa não encontrada' });
          }

          // 1. Salvar mensagem recebida do visitante no banco
          const savedMessage = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              content: text.trim(),
              contentType: 'text',
              direction: 'INBOUND',
              status: 'RECEIVED'
            }
          });

          // 2. Atualizar lastMessageAt da conversa
          const updatedConv = await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() }
          });

          // 3. Roteamento: URA (BOT) ou Agente Humano (ASSIGNED/QUEUED)
          const ioGlobal = require('./socket').getIO();
          if (ioGlobal) {
            // Emitir sempre para a sala da conversa (útil para espionagem/monitoramento em tempo real)
            ioGlobal.to(`conversation:${conversation.id}`).emit('new_message', savedMessage);
          }

          if (updatedConv.status === 'BOT') {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            await FlowEngine.process(tenant, updatedConv, savedMessage);
          } else {
            // Incrementar contador de não lidas e notificar socket global dos atendentes
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { unreadCount: { increment: 1 } }
            });

            // Disparar Socket.IO global dos agentes para atualizar listas laterais
            if (ioGlobal) {
              ioGlobal.to(`tenant:${tenantId}`).emit('new_message', savedMessage);
              if (updatedConv.assignedToId) {
                ioGlobal.to(`user:${updatedConv.assignedToId}`).emit('new_message', savedMessage);
              }
            }
          }

          if (typeof callback === 'function') {
            callback({
              success: true,
              message: {
                id: savedMessage.id,
                content: savedMessage.content,
                direction: savedMessage.direction,
                createdAt: savedMessage.createdAt
              }
            });
          }
        } catch (err) {
          logger.error('[WebchatSocketService] send_message error:', err);
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Erro ao processar mensagem.' });
          }
        }
      });

      socket.on('disconnect', () => {
        logger.socket('webchat disconnect', `Visitante ${visitorId} desconectado.`);
      });
    });
  }

  /**
   * Envia mensagem do Broker (Bot ou Agente) para o visitante via WebSocket
   */
  static async sendToClient(conversationId, content) {
    try {
      if (!nsp) {
        logger.warn('[WebchatSocketService] Namespace /webchat não inicializado, impossível emitir.');
        return;
      }

      let finalContent = content;
      if (typeof content === 'object' && content !== null) {
        if (content.type === 'interactive' || content.interactive) {
          finalContent = content;
        } else if (content.text && content.text.body) {
          finalContent = content.text.body;
        } else {
          finalContent = JSON.stringify(content);
        }
      }

      const payload = {
        content: finalContent,
        direction: 'OUTBOUND',
        createdAt: new Date()
      };

      // Disparar para a sala da conversa no namespace /webchat
      nsp.to(conversationId).emit('message_received', payload);
      logger.debug(`[WebchatSocketService] Mensagem emitida para a sala ${conversationId}`);
    } catch (error) {
      logger.error('[WebchatSocketService] Erro ao emitir mensagem para o cliente:', error);
    }
  }
}

module.exports = WebchatSocketService;
