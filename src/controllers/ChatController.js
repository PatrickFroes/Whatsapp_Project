const logger = require('../utils/logger');
const prisma =
require('../services/database');

const QueueService = require('../services/QueueService');
const AgentStatusService = require('../services/AgentStatusService');

class ChatController {
  // GET /api/chats - List all conversations for the tenant or assigned to the agent
  static async listChats(req, res) {
    try {
      const { tenantId, userId } = req.user;
      let { status, mode } = req.query; // mode: 'my', 'queue', 'all'

      // Base where clause - always exclude resolved/closed by default
      const whereClause = {
        tenantId
      };

      // Modo excluso com status específico - não misturar
      if (mode && status) {
        logger.warn('[ChatController] Both mode and status specified - ignoring status and using mode', {
          mode,
          status
        });
      }

      // IMPORTANT: Mode takes precedence over status parameter
      if (mode === 'my') {
        // Minhas conversas: atribuídas a mim
        whereClause.assignedToId = userId;
        whereClause.status = { notIn: ['RESOLVED', 'CLOSED'] };
      } else if (mode === 'queue') {
        // Fila: não atribuídas, em espera ou bot
        whereClause.assignedToId = null;
        whereClause.status = { in: ['QUEUED', 'BOT'] };
      } else if (mode === 'all') {
        // Todas não encerradas
        whereClause.status = { notIn: ['RESOLVED', 'CLOSED'] };
      } else if (status) {
        // Status específico passado diretamente
        // Validar contra enum de statuses
        const VALID_STATUSES = ['QUEUED', 'BOT', 'ASSIGNED', 'RESOLVED', 'CLOSED'];
        if (!VALID_STATUSES.includes(status.toUpperCase())) {
          logger.warn('[ChatController] Invalid status filter', { status });
          return res.status(400).json({
            error: 'Validation failed',
            details: { status: [`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`] }
          });
        }
        whereClause.status = status.toUpperCase();
      } else {
        // Default: não encerradas
        whereClause.status = { notIn: ['RESOLVED', 'CLOSED'] };
      }

      // Pagination - já validado por middleware validatePaginationLimits
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
      const skip = (page - 1) * limit;

      logger.debug('[ChatController] Listing chats', {
        tenantId,
        userId,
        mode,
        status,
        page,
        limit,
        whereClause
      });

      const [chats, totalCount] = await Promise.all([
        prisma.conversation.findMany({
          where: whereClause,
          include: {
            contact: {
              select: { id: true, phone: true, name: true }
            }
          },
          orderBy: { lastMessageAt: 'desc' },
          take: limit,
          skip: skip
        }),
        prisma.conversation.count({ where: whereClause })
      ]);

      // Calculate Queue count for UI badge
      let queueCount = 0;
      if (mode !== 'queue') {
        queueCount = await prisma.conversation.count({
          where: { tenantId, status: { in: ['QUEUED', 'BOT'] }, assignedToId: null }
        });
      }

      // Format for frontend
      const formatted = chats.map((c) => ({
        id: c.id, // Use real conversation ID
        conversationId: c.id,
        contactId: c.contact.id,
        name: c.contact.name || c.contact.phone,
        phone: c.contact.phone,
        status: c.status,
        timestamp: c.lastMessageAt,
        unread: c.unreadCount || 0
      }));

      res.json({
        chats: formatted,
        meta: {
          queueCount,
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to list chats' });
    }
  }

  // GET /api/chats/:phone/messages - Get messages for a specific chat
  static async getMessages(req, res) {
    try {
      const { phone } = req.params;
      const { tenantId } = req.user;

      const contact = await prisma.contact.findUnique({
        where: {
          tenantId_phone: { tenantId, phone }
        }
      });

      if (!contact) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      // Find active conversation (exclude RESOLVED and CLOSED)
      const conversation = await prisma.conversation.findFirst({
        where: {
          contactId: contact.id,
          tenantId,
          status: {
            notIn: ['RESOLVED', 'CLOSED']
          }
        },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 100 // Limit messages to avoid memory issues
          }
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      if (!conversation) {
        return res.json([]);
      }

      res.json(conversation.messages);
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to get messages' });
    }
  }

  // POST /api/chats/:phone/send - Send a message
  static async sendMessage(req, res) {
    try {
      const { phone } = req.params;
      const { content, type } = req.body; // text, image, etc.
      const { tenantId, userId } = req.user;

      // Validate phone format (basic)
      if (!phone || phone.length < 10) {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }

      // Validate content
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Message content is required' });
      }

      // 1. Get Tenant & Configuration for WhatsApp API
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        return res.status(400).json({ error: 'Tenant not found' });
      }

      const config = await prisma.configuration.findUnique({
        where: { tenantId }
      });
      if (!config || !config.phoneNumberId || !config.whatsappToken) {
        return res.status(400).json({ error: 'WhatsApp not configured for tenant' });
      }

      // 2. Find Contact & Conversation
      let contact = await prisma.contact.findUnique({
        where: { tenantId_phone: { tenantId, phone } }
      });

      if (!contact) {
        if (req.path.includes('history') || req.path.includes('messages')) {
          return res.status(404).json({ error: 'Chat not found' });
        }

        // Only create on Send (outbound)
        contact = await prisma.contact.create({
          data: { tenantId, phone, name: phone }
        });
      }

      let conversation = await prisma.conversation.findFirst({
        where: {
          contactId: contact.id,
          tenantId: tenantId, // SECURITY: Explicit tenant isolation
          status: {
            notIn: ['RESOLVED', 'CLOSED']
          }
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { contactId: contact.id, tenantId, status: 'ASSIGNED', assignedToId: userId }
        });
      }

      // 3. Send to Meta API
      const axios = require('axios');
      const META_API_TIMEOUT = process.env.META_API_TIMEOUT_MS || 15000; // 15 segundos timeout
      const META_API_VERSION = process.env.META_API_VERSION || 'v18.0';
      const url = `https://graph.facebook.com/${META_API_VERSION}/${config.phoneNumberId}/messages`;

      // Validar phone format
      if (!phone || phone.length < 7) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { phone: ['Phone number must have at least 7 digits'] }
        });
      }

      // Validar content
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { content: ['Message content cannot be empty'] }
        });
      }

      // Limitar tamanho da mensagem (WhatsApp limit é ~4096, usamos 5000 como buffer)
      if (content.length > 5000) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { content: ['Message cannot exceed 5000 characters'] }
        });
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: content }
      };

      let waMessageId = null;

      try {
        logger.debug('[ChatController] Sending message to Meta API', {
          tenantId,
          phoneNumberId: config.phoneNumberId,
          contentLength: content.length,
          timeout: META_API_TIMEOUT
        });

        const metaRes = await axios.post(url, payload, {
          headers: {
            Authorization: `Bearer ${config.whatsappToken}`,
            'Content-Type': 'application/json'
          },
          timeout: META_API_TIMEOUT // Timeout protection
        });

        // Validar resposta estrutura
        if (!metaRes.data) {
          logger.error('[ChatController] Meta API returned no response body', {
            status: metaRes.status,
            headers: metaRes.headers
          });
          return res.status(502).json({
            error: 'Invalid response from WhatsApp API',
            details: 'No response body received'
          });
        }

        if (!metaRes.data.messages || !Array.isArray(metaRes.data.messages) || metaRes.data.messages.length === 0) {
          logger.error('[ChatController] Meta API response missing message ID', {
            response: metaRes.data,
            tenantId,
            phoneNumberId: config.phoneNumberId
          });
          return res.status(502).json({
            error: 'Failed to get message ID from WhatsApp API',
            details: 'API did not return message ID'
          });
        }

        waMessageId = metaRes.data.messages[0].id;

        if (!waMessageId) {
          logger.error('[ChatController] Message ID is empty', {
            response: metaRes.data,
            tenantId
          });
          return res.status(502).json({
            error: 'Invalid message ID from WhatsApp API',
            details: 'Received empty message ID'
          });
        }

        logger.info('[ChatController] Message sent to Meta successfully', {
          waMessageId,
          tenantId,
          phoneNumberId: config.phoneNumberId
        });
      } catch (metaError) {
        // Melhor categorização de erros Meta
        const errorCode = metaError.response?.status;
        const errorData = metaError.response?.data;
        const errorType = errorData?.error?.type || 'UNKNOWN';
        const errorMessage = errorData?.error?.message || metaError.message;

        logger.error('[ChatController] Meta API Error', {
          status: errorCode,
          errorType,
          errorMessage,
          code: errorData?.error?.code,
          tenantId,
          timeout: META_API_TIMEOUT,
          isTimeout: metaError.code === 'ECONNABORTED'
        });

        // Retornar erro apropriado baseado no tipo
        if (metaError.code === 'ECONNABORTED') {
          return res.status(504).json({
            error: 'WhatsApp API timeout',
            details: `Request exceeded ${META_API_TIMEOUT}ms timeout`
          });
        }

        if (errorCode === 401) {
          return res.status(401).json({
            error: 'WhatsApp API authentication failed',
            details: 'Invalid or expired WhatsApp token'
          });
        }

        if (errorCode === 429) {
          return res.status(429).json({
            error: 'WhatsApp API rate limit exceeded',
            details: 'Too many requests to WhatsApp API'
          });
        }

        if (errorCode >= 500) {
          return res.status(503).json({
            error: 'WhatsApp API service unavailable',
            details: 'WhatsApp service is temporarily down'
          });
        }

        return res.status(502).json({
          error: 'Failed to send to WhatsApp',
          details: errorMessage || 'Unknown error from WhatsApp API'
        });
      }

      // 4. Store in DB - VALIDATE waMessageId first
      if (!waMessageId) {
        logger.error('[ChatController] Cannot save message: waMessageId is null or undefined', {
          conversationId: conversation.id,
          tenantId,
          contactPhone: phone
        });

        // Notificar socket about failure
        if (req.io) {
          req.io.to(`conversation:${conversation.id}`).emit('message_send_failed', {
            conversationId: conversation.id,
            error: 'Failed to get message ID from WhatsApp',
            timestamp: new Date()
          });
        }

        return res.status(502).json({
          error: 'Message send failed',
          details: 'Could not confirm message delivery to WhatsApp'
        });
      }

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content,
          contentType: type || 'text',
          direction: 'OUTBOUND',
          senderId: req.user.userId,
          waId: waMessageId,
          status: 'sent',
          createdAt: new Date()
        }
      });

      // 5. Update Conversation timestamp
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
      });

      // 6. Emit Socket Event - Conversation Room (privado)
      if (req.io) {
        req.io.to(`conversation:${conversation.id}`).emit('message_sent', {
          conversationId: conversation.id,
          phone,
          message
        });
      }

      res.status(201).json(message);
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // GET /api/agent/status - Get current agent status
  static async getStatus(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { workStatus: true, statusReason: true, lastSeenAt: true }
      });
      res.json({
        status: user.workStatus.toLowerCase(),
        reason: user.statusReason,
        lastSeenAt: user.lastSeenAt
      });
    } catch (e) {
      logger.error('[ChatController] getStatus error:', e);
      res.status(500).json({ error: 'Failed to get status' });
    }
  }

  // POST /api/agent/status - Update Status
  static async updateStatus(req, res) {
    try {
      const { status, reason } = req.body;

      if (!status) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { status: ['Status is required'] }
        });
      }

      // Validar enum de status
      const VALID_STATUSES = ['AVAILABLE', 'PAUSE', 'OFFLINE', 'BREAK'];
      if (!VALID_STATUSES.includes(status.toUpperCase())) {
        return res.status(400).json({
          error: 'Validation failed',
          details: {
            status: [`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`]
          }
        });
      }

      // Usar AgentStatusService para gerenciar status
      const result = await AgentStatusService.updateStatus(
        req.user.userId,
        status.toUpperCase(),
        reason,
        req.user.tenantId
      );

      res.json(result);
    } catch (e) {
      logger.error('[ChatController] updateStatus error:', e);
      res.status(400).json({ error: e.message || 'Failed to update status' });
    }
  }

  // POST /api/chats/:phone/resolve - Finish/Close chat
  static async resolveChat(req, res) {
    try {
      const { phone } = req.params;
      const { disposition, notes } = req.body;
      const { tenantId, userId } = req.user;

      // Validar phone
      if (!phone || phone.length < 7) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { phone: ['Phone number must have at least 7 digits'] }
        });
      }

      // Validar disposition se fornecido
      const VALID_DISPOSITIONS = ['RESOLVED', 'TRANSFERRED', 'UNRESOLVED', 'NOT_INTERESTED'];
      if (disposition && !VALID_DISPOSITIONS.includes(disposition.toUpperCase())) {
        return res.status(400).json({
          error: 'Validation failed',
          details: {
            disposition: [`Invalid disposition. Must be one of: ${VALID_DISPOSITIONS.join(', ')}`]
          }
        });
      }

      // Validar notes max length
      if (notes && typeof notes !== 'string') {
        return res.status(400).json({
          error: 'Validation failed',
          details: { notes: ['Notes must be a string'] }
        });
      }

      if (notes && notes.length > 500) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { notes: ['Notes cannot exceed 500 characters'] }
        });
      }

      // Find conversation
      const contact = await prisma.contact.findUnique({
        where: { tenantId_phone: { tenantId, phone } }
      });

      if (!contact) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          contactId: contact.id,
          tenantId: tenantId, // SECURITY: Explicit tenant isolation
          status: { notIn: ['RESOLVED', 'CLOSED'] }
        }
      });

      if (!conversation) {
        return res.status(400).json({ error: 'No active conversation' });
      }

      // Update Status
      const updatedConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: 'RESOLVED',
          assignedToId: null,
          flowState: null,
          disposition: disposition?.toUpperCase() || 'RESOLVED',
          closingNotes: notes || null,
          resolvedAt: new Date(),
          resolvedBy: userId,
          metadata: {
            ...conversation.metadata,
            closureTimestamp: new Date().toISOString()
          }
        },
        include: {
          contact: {
            select: { phone: true, name: true }
          }
        }
      });

      logger.info('[ChatController] Conversation resolved', {
        conversationId: conversation.id,
        contactPhone: phone,
        disposition,
        resolvedBy: userId,
        tenantId
      });

      // Emit event to tenant room (for supervisor dashboard, etc)
      if (req.io) {
        req.io.to(`tenant:${tenantId}`).emit('conversation_resolved', {
          conversationId: conversation.id,
          contactPhone: updatedConversation.contact.phone,
          contactName: updatedConversation.contact.name,
          disposition: disposition?.toUpperCase() || 'RESOLVED',
          resolvedBy: userId,
          resolvedAt: new Date()
        });
      }

      // Process Queue async (Agent might be free now)
      QueueService.processQueue(tenantId).catch((err) => {
        logger.error('[ChatController] Queue processing failed after resolve', {
          conversationId: conversation.id,
          error: err.message
        });
      });

      res.json({
        success: true,
        conversation: {
          id: updatedConversation.id,
          status: updatedConversation.status,
          disposition: updatedConversation.disposition
        }
      });
    } catch (error) {
      logger.error('[ChatController] resolveChat error:', {
        error: error.message,
        phone: req.params.phone,
        stack: error.stack
      });
      res.status(500).json({ error: 'Failed to resolve chat' });
    }
  }

  // GET /api/pauses - Get pause reasons configured for tenant
  static async getPauses(req, res) {
    try {
      const reasons = await AgentStatusService.getPauseReasons(req.user.tenantId);
      res.json({ reasons });
    } catch (e) {
      logger.error('[ChatController] getPauses error:', e);
      res.status(500).json({ error: e.message });
    }
  }
}

module.exports = ChatController;
