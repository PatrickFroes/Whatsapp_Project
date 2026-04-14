const prisma = require('../services/database');

const QueueService = require('../services/QueueService');
const AgentStatusService = require('../services/AgentStatusService');

class ChatController {
  // GET /api/chats - List all conversations for the tenant or assigned to the agent
  static async listChats(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { status, mode } = req.query; // mode: 'my', 'queue', 'all'

      const whereClause = {
        tenantId,
        status: { notIn: ['RESOLVED', 'CLOSED'] } // Excluir sessões encerradas por padrão
      };

      if (mode === 'my') {
        whereClause.assignedToId = userId;
        // whereClause.status = 'ASSIGNED'; // Optional: Just anything assigned to me
      } else if (mode === 'queue') {
        whereClause.status = { in: ['QUEUED', 'BOT'] }; // Pending items
        whereClause.assignedToId = null;
      } else if (status) {
        whereClause.status = status;
      }

      // Pagination to avoid memory issues
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const skip = (page - 1) * limit;

      const [chats, totalCount] = await Promise.all([
        prisma.conversation.findMany({
          where: whereClause,
          include: {
            contact: {
              select: { phone: true, name: true }
            }
          },
          orderBy: { lastMessageAt: 'desc' },
          take: limit,
          skip: skip
        }),
        prisma.conversation.count({ where: whereClause })
      ]);

      // Calculate Queue count for UI badge if asking for 'my' chats (or separate API)
      let queueCount = 0;
      if (mode !== 'queue') {
        queueCount = await prisma.conversation.count({
          where: { tenantId, status: 'QUEUED', assignedToId: null }
        });
      }

      // Format for frontend
      const formatted = chats.map((c) => ({
        id: c.contact.phone, // Frontend uses phone as ID usually
        conversationId: c.id,
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
      console.error(error);
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
      console.error(error);
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
      const url = `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: content } // Simplify for now
      };

      let waMessageId = null;

      try {
        console.log(`🔍 [ChatController] Sending message for tenant: ${tenantId}, phoneNumberId: ${config.phoneNumberId}`);
        const metaRes = await axios.post(url, payload, {
          headers: { Authorization: `Bearer ${config.whatsappToken}` }
        });

        if (metaRes.data && metaRes.data.messages && metaRes.data.messages.length > 0) {
          waMessageId = metaRes.data.messages[0].id;
        }
      } catch (metaError) {
        console.error('Meta API Error:', metaError.response?.data || metaError.message);
        return res
          .status(502)
          .json({ error: 'Failed to send to WhatsApp', details: metaError.response?.data });
      }

      // 4. Store in DB
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content,
          contentType: type || 'text',
          direction: 'OUTBOUND',
          senderId: userId,
          waId: waMessageId
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
      console.error(error);
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
      console.error('[ChatController] getStatus error:', e);
      res.status(500).json({ error: 'Failed to get status' });
    }
  }

  // POST /api/agent/status - Update Status
  static async updateStatus(req, res) {
    try {
      const { status, reason } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório' });
      }

      // Usar AgentStatusService para gerenciar status
      const result = await AgentStatusService.updateStatus(
        req.user.userId,
        status,
        reason,
        req.user.tenantId
      );

      res.json(result);
    } catch (e) {
      console.error('[ChatController] updateStatus error:', e);
      res.status(400).json({ error: e.message || 'Failed to update status' });
    }
  }

  // POST /api/chats/:phone/resolve - Finish/Close chat
  static async resolveChat(req, res) {
    try {
      const { phone } = req.params;
      const { disposition, notes } = req.body;
      const { tenantId } = req.user;

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
          disposition: disposition || 'Resolved',
          closingNotes: notes || null
        },
        include: {
          contact: {
            select: { phone: true, name: true }
          }
        }
      });

      // Emit event to tenant room (for supervisor dashboard, etc)
      if (req.io) {
        req.io.to(`tenant:${tenantId}`).emit('conversation_resolved', {
          conversationId: conversation.id,
          contactPhone: updatedConversation.contact.phone,
          contactName: updatedConversation.contact.name,
          disposition: disposition || 'Resolved',
          resolvedBy: req.user.userId
        });
      }

      // Process Queue (Agent might be free now)
      QueueService.processQueue(tenantId).catch(console.error);

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to resolve' });
    }
  }

  // GET /api/pauses - Get pause reasons configured for tenant
  static async getPauses(req, res) {
    try {
      const reasons = await AgentStatusService.getPauseReasons(req.user.tenantId);
      res.json({ reasons });
    } catch (e) {
      console.error('[ChatController] getPauses error:', e);
      res.status(500).json({ error: e.message });
    }
  }
}

module.exports = ChatController;
