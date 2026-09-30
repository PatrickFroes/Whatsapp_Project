const logger = require('../utils/logger');
const prisma =
require('../services/database');

const QueueService = require('../services/QueueService');
const AgentStatusService = require('../services/AgentStatusService');

function getDeptFromFlowState(flowState) {
  if (!flowState) return null;
  let obj = flowState;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (e) {
      return null;
    }
  }
  return (obj && typeof obj === 'object' && obj.dept) ? obj.dept : null;
}

// Helper to compile template body text by replacing placeholders with parameters
function compileTemplateText(templateObj, reqBody) {
  if (!templateObj || !templateObj.components) {
    return `Modelo enviado: ${reqBody.templateName}`;
  }

  let components = templateObj.components;
  if (typeof components === 'string') {
    try {
      components = JSON.parse(components);
    } catch (e) {
      components = [];
    }
  }
  if (components && !Array.isArray(components) && Array.isArray(components.components)) {
    components = components.components;
  }
  if (!Array.isArray(components)) {
    return `Modelo enviado: ${reqBody.templateName}`;
  }

  const bodyComp = components.find(c => c.type === 'BODY');
  if (!bodyComp || !bodyComp.text) {
    return `Modelo enviado: ${reqBody.templateName}`;
  }

  let text = bodyComp.text;

  // Extrair parâmetros
  let params = [];
  if (reqBody.parameters && Array.isArray(reqBody.parameters)) {
    params = reqBody.parameters;
  } else if (reqBody.components && Array.isArray(reqBody.components)) {
    const bodyComponentVal = reqBody.components.find(c => c.type === 'body');
    if (bodyComponentVal && Array.isArray(bodyComponentVal.parameters)) {
      params = bodyComponentVal.parameters.map(p => p.text || '');
    }
  }

  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  const variables = new Set();
  while ((match = regex.exec(text)) !== null) {
    variables.add(match[1].trim());
  }
  const uniqueVars = Array.from(variables);
  const isAllNumeric = uniqueVars.every(v => /^\d+$/.test(v));
  if (isAllNumeric) {
    uniqueVars.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  uniqueVars.forEach((name, idx) => {
    if (idx < params.length) {
      text = text.split(`{{${name}}}`).join(String(params[idx]));
    }
  });

  return text;
}

class ChatController {
  // GET /api/chats - List all conversations for the tenant or assigned to the agent
  static async listChats(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { status, mode } = req.query; // mode: 'my', 'queue', 'all'

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
        whereClause.status = { notIn: ['RESOLVED', 'CLOSED', 'BOT'] };
      } else if (mode === 'queue') {
        // Fila: não atribuídas, em espera ou bot (Bloqueado para Agentes)
        if (req.user.role === 'AGENT') {
          return res.status(403).json({ error: 'Acesso negado. Agentes não podem visualizar a fila.' });
        }
        whereClause.assignedToId = null;
        whereClause.status = { in: ['QUEUED', 'BOT'] };
      } else if (mode === 'all') {
        // Todas não encerradas (Forçar filtro do próprio agente se for AGENT)
        if (req.user.role === 'AGENT') {
          whereClause.assignedToId = userId;
        }
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
        // Se for agente comum e tentar puxar status QUEUED ou BOT, proibir
        if (req.user.role === 'AGENT' && ['QUEUED', 'BOT'].includes(status.toUpperCase())) {
          return res.status(403).json({ error: 'Acesso negado. Agentes não podem visualizar a fila.' });
        }
        whereClause.status = status.toUpperCase();
        if (req.user.role === 'AGENT' && status.toUpperCase() === 'ASSIGNED') {
          whereClause.assignedToId = userId;
        }
      } else {
        // Default: não encerradas (Forçar filtro do próprio agente se for AGENT)
        if (req.user.role === 'AGENT') {
          whereClause.assignedToId = userId;
        }
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
            },
            whatsappConnection: {
              select: { name: true }
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
        assignedToId: c.assignedToId,
        timestamp: c.lastMessageAt,
        unread: c.unreadCount || 0,
        whatsappPhoneId: c.whatsappPhoneId,
        channelName: c.whatsappConnection?.name || 'Padrão'
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
      const { whatsappPhoneId, conversationId } = req.query;

      const isHistoryQuery = req.path.includes('/history') || req.query.includeClosed === 'true';

      let phoneOptions;
      if (phone.startsWith('vst_')) {
        phoneOptions = [phone];
      } else {
        const { getBrPhoneOptions } = require('../utils/validators');
        phoneOptions = getBrPhoneOptions(phone);
      }

      const whereObj = {
        tenantId
      };

      if (!isHistoryQuery) {
        whereObj.status = {
          notIn: ['RESOLVED', 'CLOSED']
        };
      }

      if (conversationId) {
        whereObj.id = conversationId;
      } else {
        whereObj.contact = { phone: { in: phoneOptions } };
        if (whatsappPhoneId) {
          whereObj.whatsappPhoneId = whatsappPhoneId;
        }
      }

      // Find active conversation using relation
      const conversation = await prisma.conversation.findFirst({
        where: whereObj,
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 100 // Limit messages to avoid memory issues
          },
          internalNotes: {
            include: {
              user: {
                select: { id: true, name: true, role: true }
              }
            },
            orderBy: { createdAt: 'asc' }
          }
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      if (!conversation) {
        // Check if at least one contact exists to preserve correct 404 behavior
        const contactExists = await prisma.contact.findFirst({
          where: {
            tenantId,
            phone: { in: phoneOptions }
          }
        });
        if (!contactExists) {
          return res.status(404).json({ error: 'Chat not found' });
        }
        return res.json([]);
      }

      // Enforce agent assignment check
      if (req.user.role === 'AGENT' && conversation.assignedToId !== req.user.userId) {
        return res.status(403).json({ error: 'Acesso negado. Esta conversa não está atribuída a você.' });
      }

      // 🛡️ Resetar contador de mensagens não lidas no banco
      if (conversation.unreadCount > 0) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { unreadCount: 0 }
        }).catch(err => logger.error('[ChatController] Error resetting unreadCount:', err.message));
        conversation.unreadCount = 0;
      }

      // Mesclar mensagens públicas e notas internas/sussurros em ordem cronológica
      const publicMessages = (conversation.messages || []).map(m => ({
        ...m,
        isPrivate: false
      }));

      const internalWhispers = (conversation.internalNotes || []).map(n => ({
        id: n.id,
        conversationId: n.conversationId,
        content: n.content,
        contentType: 'whisper',
        isPrivate: true,
        direction: 'INTERNAL',
        senderId: n.userId,
        senderName: n.user?.name || 'Supervisor',
        senderRole: n.user?.role || 'SUPERVISOR',
        createdAt: n.createdAt,
        status: 'INTERNAL'
      }));

      const combinedMessages = [...publicMessages, ...internalWhispers].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );

      res.setHeader('X-Conversation-Owner-Id', conversation.assignedToId || '');
      res.json(combinedMessages);
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to get messages' });
    }
  }

  // POST /api/chats/:phone/send - Send a message
  static async sendMessage(req, res) {
    try {
      const { phone } = req.params;
      const { content, type, whatsappPhoneId, conversationId, isPrivate } = req.body;
      const { tenantId, userId } = req.user;

      // Validate phone format (basic)
      if (!phone || phone.length < 10) {
        return res.status(400).json({ error: 'Invalid phone number format' });
      }

      // Validate content based on message type
      const isTemplate = type === 'template';
      if (!isTemplate) {
        if (!content || content.trim().length === 0) {
          return res.status(400).json({ error: 'Message content is required' });
        }
      } else {
        if (!req.body.templateName) {
          return res.status(400).json({ error: 'templateName is required for template messages' });
        }
      }

      // 1. Get Tenant
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        return res.status(400).json({ error: 'Tenant not found' });
      }

      // 2. Find Contact & Conversation
      let phoneOptions;
      if (phone.startsWith('vst_')) {
        phoneOptions = [phone];
      } else {
        const { getBrPhoneOptions } = require('../utils/validators');
        phoneOptions = getBrPhoneOptions(phone);
      }

      const convWhere = {
        tenantId: tenantId, // SECURITY: Explicit tenant isolation
        status: {
          notIn: ['RESOLVED', 'CLOSED']
        }
      };

      if (conversationId) {
        convWhere.id = conversationId;
      } else {
        convWhere.contact = { phone: { in: phoneOptions } };
        if (whatsappPhoneId) {
          convWhere.whatsappPhoneId = whatsappPhoneId;
        }
      }

      let conversation = await prisma.conversation.findFirst({
        where: convWhere,
        include: {
          contact: true
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      // 🛡️ Modo Sussurro (Whisper do Supervisor - Persiste na conversa ativa e auditoria, sem despachar para o WhatsApp)
      const isWhisper = type === 'whisper' || type === 'internal_note' || isPrivate === true;
      if (isWhisper) {
        if (!conversation) {
          return res.status(404).json({ error: 'Conversa ativa não encontrada para enviar sussurro.' });
        }

        const InternalNoteService = require('../services/InternalNoteService');
        const note = await InternalNoteService.create(
          conversation.id,
          userId,
          tenantId,
          content.trim(),
          req.user.role || 'SUPERVISOR'
        );

        const whisperPayload = {
          id: note.id,
          conversationId: note.conversationId,
          phone,
          content: note.content,
          contentType: 'whisper',
          isPrivate: true,
          direction: 'INTERNAL',
          senderId: note.userId,
          senderName: note.user?.name || req.user.username || 'Supervisor',
          senderRole: note.user?.role || req.user.role || 'SUPERVISOR',
          createdAt: note.createdAt,
          status: 'INTERNAL'
        };

        // Notificar via WebSocket apenas na sala da conversa para evitar duplicatas
        if (req.io) {
          req.io.to(`conversation:${conversation.id}`).emit('whisper_message', whisperPayload);
        }

        return res.json({
          success: true,
          isPrivate: true,
          whisper: whisperPayload,
          note: whisperPayload,
          message: whisperPayload
        });
      }

      // Determinar se é Webchat ou Telegram
      const isWebchat = conversation ? (conversation.channel === 'WEBCHAT') : false;
      const isTelegram = conversation ? (conversation.channel === 'TELEGRAM') : phone.startsWith('tg_');

      // Se for WhatsApp, carregar configurações de WhatsApp
      let config = null;
      if (!isWebchat && !isTelegram) {
        if (whatsappPhoneId) {
          config = await prisma.configuration.findFirst({
            where: { tenantId, phoneNumberId: whatsappPhoneId }
          });
        } else if (conversation && conversation.whatsappPhoneId) {
          config = await prisma.configuration.findFirst({
            where: { tenantId, phoneNumberId: conversation.whatsappPhoneId }
          });
        }

        if (!config) {
          config = await prisma.configuration.findFirst({
            where: { tenantId }
          });
        }

        if (!config || !config.phoneNumberId || !config.whatsappToken) {
          return res.status(400).json({ error: 'WhatsApp not configured for tenant' });
        }
      }

      let contact;
      if (conversation) {
        contact = conversation.contact;
      } else {
        contact = await prisma.contact.findFirst({
          where: {
            tenantId,
            phone: { in: phoneOptions }
          }
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
      }

      // Get user limits
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { maxActiveChats: true, maxReceivedChats: true }
      });
      const maxActive = user?.maxActiveChats ?? 5;
      const maxReceived = user?.maxReceivedChats ?? 5;

      if (!conversation) {
        // 🛡️ Validação de Limites de Disparos Mensais (SaaS)
        const { checkOutboundLimit } = require('../utils/limitGuard');
        const allowedOutbound = await checkOutboundLimit(tenantId);
        if (!allowedOutbound) {
          return res.status(403).json({
            error: 'Limit exceeded',
            details: 'O limite mensal de conversas ativas iniciadas (disparos) para a sua empresa foi atingido.'
          });
        }

        // Checking limit for active/outbound chat creation
        const currentActiveCount = await prisma.conversation.count({
          where: {
            tenantId,
            assignedToId: userId,
            status: { notIn: ['RESOLVED', 'CLOSED'] },
            initiationType: 'OUTBOUND'
          }
        });

        if (currentActiveCount >= maxActive) {
          return res.status(400).json({
            error: 'Limit exceeded',
            details: `Você atingiu o limite de chats ativos simultâneos (${maxActive}).`
          });
        }

        conversation = await prisma.conversation.create({
          data: {
            contactId: contact.id,
            tenantId,
            status: 'ASSIGNED',
            assignedToId: userId,
            initiationType: 'OUTBOUND',
            whatsappPhoneId: config ? config.phoneNumberId : null,
            channel: 'WHATSAPP'
          }
        });
      } else {
        // If conversation exists but is not assigned to current agent
        if (conversation.assignedToId !== userId) {
          // Bloquear agentes de interagirem com chats na fila ou atribuídos a terceiros
          if (req.user.role === 'AGENT') {
            return res.status(403).json({
              error: 'Acesso negado',
              details: 'Você não pode interagir com conversas que não estão atribuídas a você.'
            });
          }

          const isOutbound = conversation.initiationType === 'OUTBOUND';
          const limit = isOutbound ? maxActive : maxReceived;
          const limitTypeLabel = isOutbound ? 'ativos' : 'recebidos';

          const currentCount = await prisma.conversation.count({
            where: {
              tenantId,
              assignedToId: userId,
              status: { notIn: ['RESOLVED', 'CLOSED'] },
              initiationType: isOutbound ? 'OUTBOUND' : 'INBOUND'
            }
          });

          if (currentCount >= limit) {
            return res.status(400).json({
              error: 'Limit exceeded',
              details: `Você atingiu o limite de chats ${limitTypeLabel} simultâneos (${limit}).`
            });
          }

          // Claim / Assign the conversation to this agent (only for Admin/Supervisor)
          conversation = await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              status: 'ASSIGNED',
              assignedToId: userId
            }
          });
        }
      }

      // Validar phone format
      if (!phone || phone.length < 7) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { phone: ['Phone number must have at least 7 digits'] }
        });
      }

      // Validar content/template e preparar payload
      let finalContent = content;
      let payload;

      if (isTemplate) {
        const templateName = req.body.templateName;
        const templateLanguage = req.body.language || 'pt_BR';
        const parameters = req.body.parameters || [];
        const templateComponents = req.body.components;

        // Buscar template no banco para compilar o texto final
        const templateObj = await prisma.template.findUnique({
          where: { tenantId_name: { tenantId, name: templateName } }
        });

        if (!templateObj) {
          return res.status(404).json({ error: `Template '${templateName}' não encontrado no banco de dados.` });
        }

        // Compilar texto final para salvar no banco
        finalContent = compileTemplateText(templateObj, req.body);

        // Montar payload da Meta API
        let templateObjComponents = templateObj.components;
        if (typeof templateObjComponents === 'string') {
          try {
            templateObjComponents = JSON.parse(templateObjComponents);
          } catch (e) {
            templateObjComponents = [];
          }
        }
        if (templateObjComponents && !Array.isArray(templateObjComponents) && Array.isArray(templateObjComponents.components)) {
          templateObjComponents = templateObjComponents.components;
        }
        if (!Array.isArray(templateObjComponents)) {
          templateObjComponents = [];
        }

        const normalizedParams = parameters.map((p, idx) => {
          if (p && typeof p === 'object' && 'name' in p && 'value' in p) {
            return { name: p.name, value: p.value };
          }
          let placeholderName = String(idx + 1);
          const bodyComp = templateObjComponents.find(c => c.type === 'BODY');
          if (bodyComp && bodyComp.text) {
            const regex = /\{\{([^}]+)\}\}/g;
            let match;
            const placeholders = [];
            while ((match = regex.exec(bodyComp.text)) !== null) {
              const pName = match[1].trim();
              if (!placeholders.includes(pName)) {
                placeholders.push(pName);
              }
            }
            if (placeholders[idx]) {
              placeholderName = placeholders[idx];
            }
          }
          return { name: placeholderName, value: String(p) };
        });

        const componentsPayload = templateComponents || (normalizedParams.length > 0 ? [
          {
            type: 'body',
            parameters: normalizedParams.map(p => {
              const paramObj = {
                type: 'text',
                text: String(p.value)
              };
              if (!/^\d+$/.test(p.name)) {
                paramObj.parameter_name = p.name;
              }
              return paramObj;
            })
          }
        ] : []);

        payload = {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: templateLanguage
            },
            components: componentsPayload
          }
        };
      } else {
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
          return res.status(400).json({
            error: 'Validation failed',
            details: { content: ['Message content cannot be empty'] }
          });
        }

        // Limitar tamanho da mensagem
        if (content.length > 5000) {
          return res.status(400).json({
            error: 'Validation failed',
            details: { content: ['Message cannot exceed 5000 characters'] }
          });
        }

        payload = {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body: content }
        };
      }

      let waMessageId = null;

      try {
        if (conversation.channel === 'WEBCHAT') {
          logger.debug('[ChatController] Sending message to Webchat client', {
            tenantId,
            conversationId: conversation.id
          });
          const WebchatSocketService = require('../services/WebchatSocketService');
          await WebchatSocketService.sendToClient(conversation.id, finalContent);
          const crypto = require('crypto');
          waMessageId = 'webchat_' + crypto.randomUUID();
        } else if (conversation.channel === 'TELEGRAM' || phone.startsWith('tg_')) {
          logger.debug('[ChatController] Sending message to Telegram client', {
            tenantId,
            conversationId: conversation.id
          });
          const TelegramService = require('../services/TelegramService');
          const telegramConfig = tenant.telegramConfig || {};
          if (!telegramConfig.botToken) {
            return res.status(400).json({ error: 'Canal Telegram não configurado ou desativado para este tenant' });
          }
          const chatId = phone.replace('tg_', '');
          const tgRes = await TelegramService.sendMessage(telegramConfig.botToken, chatId, finalContent);
          waMessageId = 'tg_' + (tgRes?.result?.message_id || Date.now());
        } else {
          const axios = require('axios');
          const META_API_TIMEOUT = process.env.META_API_TIMEOUT_MS || 15000; // 15 segundos timeout
          const META_API_VERSION = process.env.META_API_VERSION || 'v18.0';
          const url = `https://graph.facebook.com/${META_API_VERSION}/${config.phoneNumberId}/messages`;

          logger.debug('[ChatController] Sending message to Meta API', {
            tenantId,
            phoneNumberId: config.phoneNumberId,
            contentLength: finalContent ? finalContent.length : 0,
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
        }
      } catch (metaError) {
        if (conversation.channel === 'WEBCHAT') {
          logger.error('[ChatController] Webchat send error:', metaError.message);
          return res.status(500).json({ error: 'Failed to send to Webchat client' });
        }

        // Melhor categorização de erros Meta
        const errorCode = metaError.response?.status;
        const errorData = metaError.response?.data;
        const errorType = errorData?.error?.type || 'UNKNOWN';
        const errorMessage = errorData?.error?.message || metaError.message;

        logger.error(
          `[ChatController] Meta API Error: ${errorMessage} (status: ${errorCode}, type: ${errorType}, code: ${errorData?.error?.code}, phone: ${phone})`,
          metaError
        );

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
          content: finalContent,
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

      const normalizedInput = String(status).trim().toUpperCase();
      const statusAliases = {
        ONLINE: 'ONLINE',
        AVAILABLE: 'ONLINE',
        OFFLINE: 'OFFLINE',
        PAUSED: 'PAUSED',
        PAUSE: 'PAUSED',
        BREAK: 'AWAY',
        AWAY: 'AWAY',
        BUSY: 'BUSY'
      };

      const normalizedStatus = statusAliases[normalizedInput];
      const validInputs = Object.keys(statusAliases);

      if (!normalizedStatus) {
        return res.status(400).json({
          error: 'Validation failed',
          details: {
            status: [`Invalid status. Must be one of: ${validInputs.join(', ')}`]
          }
        });
      }

      // Usar AgentStatusService para gerenciar status
      const result = await AgentStatusService.updateStatus(
        req.user.userId,
        normalizedStatus,
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
      const { disposition, notes, whatsappPhoneId, conversationId } = req.body;
      const { tenantId, userId } = req.user;

      // Validar phone
      if (!phone || phone.length < 7) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { phone: ['Phone number must have at least 7 digits'] }
        });
      }

      // Validar disposition se fornecido (permitir qualquer string de até 100 caracteres)
      if (disposition && (typeof disposition !== 'string' || disposition.length > 100)) {
        return res.status(400).json({
          error: 'Validation failed',
          details: {
            disposition: ['Disposition must be a string and cannot exceed 100 characters']
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
      let phoneOptions;
      if (phone.startsWith('vst_')) {
        phoneOptions = [phone];
      } else {
        const { getBrPhoneOptions } = require('../utils/validators');
        phoneOptions = getBrPhoneOptions(phone);
      }

      const convWhere = {
        tenantId: tenantId, // SECURITY: Explicit tenant isolation
        status: { notIn: ['RESOLVED', 'CLOSED'] }
      };

      if (conversationId) {
        convWhere.id = conversationId;
      } else {
        convWhere.contact = { phone: { in: phoneOptions } };
        if (whatsappPhoneId) {
          convWhere.whatsappPhoneId = whatsappPhoneId;
        }
      }

      const conversation = await prisma.conversation.findFirst({
        where: convWhere
      });

      if (!conversation) {
        // Check if contact exists to return 404 or 400
        const contactExists = await prisma.contact.findFirst({
          where: {
            tenantId,
            phone: { in: phoneOptions }
          }
        });
        if (!contactExists) {
          return res.status(404).json({ error: 'Chat not found' });
        }
        return res.status(400).json({ error: 'No active conversation' });
      }

      // Enforce agent assignment check
      if (req.user.role === 'AGENT' && conversation.assignedToId !== userId) {
        return res.status(403).json({ error: 'Acesso negado. Esta conversa não está atribuída a você.' });
      }

      // Update Status (Check for NPS Survey first)
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });

      let campaign = null;
      if (conversation.campaignId) {
        campaign = await prisma.campaign.findUnique({
          where: { id: conversation.campaignId }
        });
      }

      let surveyFlowId = null;
      if (campaign && campaign.surveyEnabled && campaign.surveyFlowId) {
        surveyFlowId = campaign.surveyFlowId;
      } else if (tenant && tenant.featureSurvey && tenant.surveyEnabled && tenant.surveyFlowId) {
        surveyFlowId = tenant.surveyFlowId;
      }

      const flows = tenant?.flows || {};
      const surveyFlow = surveyFlowId ? flows.uras?.[surveyFlowId] : null;

      const currentDept = getDeptFromFlowState(conversation.flowState);

      if (surveyFlow) {
        // Redireciona para BOT para iniciar a pesquisa
        const updatedConversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'BOT',
            disposition: disposition || 'Enviado para Pesquisa',
            closingNotes: notes || null,
            flowState: {
              nodeId: 'start',
              step: 0,
              data: {},
              isSurvey: true,
              surveyFlowId,
              dept: currentDept // Preserva a skill durante a pesquisa
            }
          },
          include: {
            contact: { select: { phone: true, name: true } }
          }
        });

        logger.info('[ChatController] Conversation redirected to NPS survey', {
          conversationId: conversation.id,
          surveyFlowId,
          tenantId
        });

        const FlowEngine = require('../services/FlowEngine');
        const freshConv = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          include: { contact: true }
        });

        // Executa primeiro nó do fluxo de pesquisa de forma assíncrona
        FlowEngine.executeNode(tenant, freshConv, surveyFlow, updatedConversation.flowState, null).catch(err => {
          logger.error('[ChatController] Erro ao executar primeiro nó de pesquisa:', err.message);
        });

        // Notifica painel do agente para arquivar tela local
        if (req.io) {
          req.io.to(`tenant:${tenantId}`).emit('conversation_resolved', {
            conversationId: conversation.id,
            contactPhone: updatedConversation.contact.phone,
            contactName: updatedConversation.contact.name,
            disposition: 'Enviado para Pesquisa',
            resolvedBy: userId,
            resolvedAt: new Date().toISOString()
          });
        }

        const QueueService = require('../services/QueueService');
        QueueService.processQueue(tenantId).catch(err => {
          logger.error('[ChatController] Queue process failed after survey redirection:', err.message);
        });

        // Verificar se o agente tem status pendente para aplicar
        const AgentStatusService = require('../services/AgentStatusService');
        await AgentStatusService.checkAndApplyPendingStatus(userId, tenantId);

        return res.json({
          success: true,
          surveyTriggered: true,
          conversation: {
            id: updatedConversation.id,
            status: updatedConversation.status
          }
        });
      }

      const updatedConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: 'RESOLVED',
          flowState: currentDept ? { dept: currentDept } : null, // Preserva a skill no flowState pós-resolução
          disposition: disposition || 'RESOLVED',
          closingNotes: notes || null
        },
        include: {
          contact: {
            select: { phone: true, name: true }
          }
        }
      });

      // Enfileirar para IA se o recurso estiver habilitado
      if (tenant?.featureAiSummary) {
        const { enqueueConversation } = require('../queues/aiQueue');
        enqueueConversation(conversation.id);
      }

      // Dispara webhook de fechamento/resolução para CRM externo
      const CloseWebhookService = require('../services/CloseWebhookService');
      CloseWebhookService.trigger(conversation.id).catch(err => {
        logger.error('[ChatController] CloseWebhook trigger failed:', err.message);
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
          disposition: disposition || 'RESOLVED',
          resolvedBy: userId,
          resolvedAt: new Date().toISOString()
        });
      }

      // Process Queue async (Agent might be free now)
      QueueService.processQueue(tenantId).catch((err) => {
        logger.error('[ChatController] Queue processing failed after resolve', {
          conversationId: conversation.id,
          error: err.message
        });
      });

      // Verificar se o agente tem status pendente para aplicar
      const AgentStatusService = require('../services/AgentStatusService');
      await AgentStatusService.checkAndApplyPendingStatus(userId, tenantId);

      res.json({
        success: true,
        conversation: {
          id: updatedConversation.id,
          status: updatedConversation.status,
          disposition: updatedConversation.disposition
        }
      });
    } catch (error) {
      logger.error(`[ChatController] resolveChat error for phone ${req.params.phone}: ${error.message || error}`, error);
      res.status(500).json({ error: 'Failed to resolve chat' });
    }
  }

  // GET /api/chats/connections - List active WhatsApp connections for selection
  static async listConnections(req, res) {
    try {
      const { tenantId } = req.user;
      const connections = await prisma.configuration.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          phoneNumberId: true,
          status: true
        }
      });
      res.json(connections);
    } catch (error) {
      logger.error('[ChatController] listConnections error:', error);
      res.status(500).json({ error: 'Failed to list active connections' });
    }
  }

  // GET /api/pauses - Get pause reasons configured for tenant
  static async getPauses(req, res) {
    try {
      const reasons = await AgentStatusService.getPauseReasons(req.user.tenantId);
      res.json({ reasons });
    } catch (e) {
      logger.error('[ChatController] getPauses error:', e);
      res.status(500).json({ error: 'Failed to get pause reasons' });
    }
  }

  // GET /api/dispositions - Get close dispositions configured for tenant
  static async getDispositions(req, res) {
    try {
      const dispositions = await AgentStatusService.getCloseDispositions(req.user.tenantId);
      res.json({ dispositions });
    } catch (e) {
      logger.error('[ChatController] getDispositions error:', e);
      res.status(500).json({ error: 'Failed to get dispositions' });
    }
  }
}

module.exports = ChatController;
