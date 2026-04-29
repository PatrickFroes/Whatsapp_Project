const prisma = const logger = require('../utils/logger');
const '../services/database');
const FlowEngine = require('../services/FlowEngine');

class WebhookController {
  /**
   * Verification Endpoint for Meta
   *
   * Meta envia GET com 3 parâmetros:
   * - hub.mode = 'subscribe'
   * - hub.verify_token = token que foi configurado em Meta Dashboard
   * - hub.challenge = challenge a retornar
   *
   * ANTES: Validávamos against process.env.WEBHOOK_VERIFY_TOKEN (erro!)
   * DEPOIS: Apenas respondemos ao challenge (Meta valida endpoint está ativo)
   *
   * A validação real ocorre em POST via HMAC (header X-Hub-Signature-256)
   */
  static async verify(req, res) {
    logger.debug('🔍 [Webhook VERIFY] Raw request:', {
      method: req.method,
      url: req.url,
      originalUrl: req.originalUrl,
      query: req.query,
      queryString: req._parsedUrl?.query || 'N/A',
      headers: { host: req.headers.host, 'user-agent': req.headers['user-agent'] }
    });

    const mode = req.query['hub.mode'];
    const verifyToken = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    logger.debug('🔍 [Webhook VERIFY] Parsed params:', { mode, verifyToken, challenge });

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      logger.warn('[Webhook] Invalid verification request payload');
      logger.warn('   Expected: hub.mode=subscribe, hub.verify_token=<token>, hub.challenge=<challenge>');
      logger.warn(`   Received: mode=${mode}, token=${verifyToken}, challenge=${challenge}`);
      return res.sendStatus(403);
    }

    try {
      // Multi-tenant validation: verify token must match at least one tenant configuration.
      const config = await prisma.configuration.findFirst({
        where: { verifyToken },
        select: { tenantId: true }
      });

      if (!config) {
        logger.warn('[Webhook] Verification failed: unknown verify token');
        return res.sendStatus(403);
      }

      logger.debug(`[Webhook] Subscription verified for tenant ${config.tenantId}`);
      return res.status(200).send(challenge);
    } catch (error) {
      logger.error('[Webhook] Verification error:', error);
      return res.sendStatus(500);
    }
  }

  /**
   * Main Event Handler
   *
   * HMAC foi validado pelo middleware validateWebhookHmac:
   * - req.tenant = tenant object
   * - req.webhookConfig = configuration object
   *
   * Fluxo:
   * 1. Extrai tipo de evento (messages, statuses, etc)
   * 2. Processa conforme tipo
   */
  static async handle(req, res) {
    // Responder imediatamente para evitar timeout
    res.sendStatus(200);

    const { body } = req;

    // Tenant foi validado/injetado pelo middleware validateWebhookHmac
    const tenant = req.tenant;

    if (!tenant) {
      logger.error('[Webhook] Missing tenant from middleware');
      return;
    }

    // Carregar dados do evento
    if (body.object === 'whatsapp_business_account') {
      try {
        if (!body.entry || body.entry.length === 0) {
          return;
        }

        for (const entry of body.entry) {
          const { changes } = entry;
          for (const change of changes) {
            const { value } = change;

            if (!value) {
              continue;
            }

            // Processar Mensagens
            if (value.messages && value.messages.length > 0) {
              for (const message of value.messages) {
                await WebhookController.processMessage(tenant, value.contacts, message, req.io);
              }
            }

            // Processar Status Updates (enviado, entregue, lido)
            if (value.statuses && value.statuses.length > 0) {
              for (const status of value.statuses) {
                await WebhookController.processStatus(tenant, status, req.io);
              }
            }
          }
        }
      } catch (error) {
        logger.error('[Webhook] Error processing webhook:', error);
      }
    }
  }

  static async processMessage(tenant, contacts, msg, io) {
    // LAW: Only process genuine conversational messages.
    // WhatsApp sends non-conversational events (reactions, read receipts, system) as
    // message-type webhook entries. Without this guard they would create new BOT
    // conversations on closed sessions and trigger the welcome flow with no user intent.
    const CONVERSATIONAL_TYPES = [
      'text',
      'image',
      'video',
      'audio',
      'document',
      'location',
      'sticker',
      'interactive',
      'button',
      'order'
    ];
    if (!CONVERSATIONAL_TYPES.includes(msg.type)) {
      logger.debug(`[Webhook] Skipping non-conversational event type="${msg.type}" waId=${msg.id}`);
      return;
    }

    // IDEMPOTENCY GUARD: Meta may deliver the same webhook event multiple times.
    // If this waId is already in the database, this is a duplicate — skip entirely.
    if (msg.id) {
      const alreadyProcessed = await prisma.message.findUnique({
        where: { waId: msg.id },
        select: { id: true }
      });
      if (alreadyProcessed) {
        logger.debug(`[Webhook] Duplicate message ignored (already processed): waId=${msg.id}`);
        return;
      }
    }

    // 1. Resolving Contact Name (from payload or DB)
    const senderPhone = msg.from;
    const contactProfile = contacts.find((c) => c.wa_id === senderPhone);
    const contactName = contactProfile?.profile?.name || senderPhone;

    // 2. Find or Create Contact
    let contact = await prisma.contact.findUnique({
      where: {
        tenantId_phone: {
          tenantId: tenant.id,
          phone: senderPhone
        }
      }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          tenantId: tenant.id,
          phone: senderPhone,
          name: contactName
        }
      });
    } else if (contactName && contactName !== contact.name && contactName !== senderPhone) {
      // Update name when WhatsApp profile changes (non-critical)
      try {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: { name: contactName }
        });
        logger.debug(`[Webhook] Contact name updated: ${senderPhone} → ${contactName}`);
      } catch (nameUpdateErr) {
        logger.warn('[Webhook] Failed to update contact name:', nameUpdateErr.message);
      }
    }

    // 3. Find or Create Active Conversation
    // Strategy: Find any ACTIVE conversation (BOT, QUEUED, ASSIGNED)
    // RESOLVED and CLOSED sessions must NEVER be reused - always create new
    let conversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        tenantId: tenant.id,
        status: {
          in: ['BOT', 'QUEUED', 'ASSIGNED']
        }
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    // LAW: A QUEUED conversation stuck waiting for business hours must be restarted
    // when the client sends a new message. Without this, FlowEngine skips it
    // (status !== 'BOT') and the client receives no response.
    // FlowEngine will then decide: if business is still closed → re-send offline message + re-queue;
    // if business is now open → run the full bot flow normally.
    if (
      conversation &&
      conversation.status === 'QUEUED' &&
      conversation.flowState?.waitingForBusiness === true
    ) {
      logger.debug(
        `[Webhook] Client messaged a waitingForBusiness conversation. Resetting to BOT: ${conversation.id}`
      );
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'BOT', flowState: null }
      });
    }

    // Create new conversation if no active one exists.
    // RESOLVED and CLOSED are excluded from the search above — they are NEVER reactivated.
    // A new clean BOT session is always created for a new contact or after a closed session.
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          contactId: contact.id,
          tenantId: tenant.id,
          status: 'BOT',
          lastMessageAt: new Date()
        }
      });
      logger.debug(`[Webhook] New conversation created: ${conversation.id} for ${senderPhone}`);
    }

    // 4. Save Message
    let content = '';
    let contentType = msg.type;
    let mediaUrl = null;
    const mediaSize = null;
    let mediaMimeType = null;
    let mediaFilename = null;

    if (contentType === 'text') {
      content = msg.text.body;
    } else if (contentType === 'interactive') {
      if (msg.interactive.type === 'button_reply') {
        content = msg.interactive.button_reply.title;
      } else if (msg.interactive.type === 'list_reply') {
        content = msg.interactive.list_reply.title;
      } else {
        content = '[Interactive]';
      }
    } else if (contentType === 'image') {
      content = msg.image.caption || '[Imagem]';
      mediaUrl = msg.image.id; // WhatsApp media ID
      mediaMimeType = msg.image.mime_type;
      mediaFilename = msg.image.filename || 'image.jpg';
    } else if (contentType === 'video') {
      content = msg.video.caption || '[Vídeo]';
      mediaUrl = msg.video.id;
      mediaMimeType = msg.video.mime_type;
      mediaFilename = msg.video.filename || 'video.mp4';
    } else if (contentType === 'audio') {
      content = '[Áudio]';
      mediaUrl = msg.audio.id;
      mediaMimeType = msg.audio.mime_type;
      mediaFilename = 'audio.ogg';
    } else if (contentType === 'document') {
      content = msg.document.caption || '[Documento]';
      mediaUrl = msg.document.id;
      mediaMimeType = msg.document.mime_type;
      mediaFilename = msg.document.filename || 'document.pdf';
    } else if (contentType === 'sticker') {
      content = '[Sticker]';
      mediaUrl = msg.sticker.id;
      mediaMimeType = msg.sticker.mime_type;
    } else if (contentType === 'location') {
      const loc = msg.location;
      content = `📍 ${loc.name || 'Localização'}`;
      if (loc.address) {
        content += ` - ${loc.address}`;
      }
      contentType = 'location';
    } else {
      content = `[${contentType}]`;
    }

    // 4. Save Message + Update Conversation in a transaction (atomic)
    const messageTimestamp = new Date();
    const [savedMessage] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          content,
          contentType,
          direction: 'INBOUND',
          status: 'RECEIVED',
          mediaUrl,
          mediaSize,
          mediaMimeType,
          mediaFilename,
          waId: msg.id,
          fromUser: senderPhone,
          senderId: contact.id
        }
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: messageTimestamp,
          unreadCount: { increment: 1 }
        }
      })
    ]);

    // 6. Real-time Notification - Arquitetura Híbrida
    if (io) {
      // Emitir para conversation room (agente atribuído recebe mensagem completa)
      io.to(`conversation:${conversation.id}`).emit('new_message', {
        conversationId: conversation.id,
        message: savedMessage,
        contact: contact
      });

      // Emitir para tenant room (atualizar lista de chats para todos)
      io.to(`tenant:${tenant.id}`).emit('chat_list_update', {
        conversationId: conversation.id,
        lastMessage: savedMessage.content,
        timestamp: savedMessage.createdAt,
        unreadCount: conversation.unreadCount + 1
      });
    }

    // 7. Bot Execution (URA)
    try {
      await FlowEngine.process(tenant, conversation, savedMessage);
    } catch (err) {
      logger.error('[Webhook] Bot Execution Failed:', {
        conversationId: conversation.id,
        contactPhone: senderPhone,
        error: err.message
      });
      // Fallback: Se bot falhou e a conversão ainda está em BOT, transfere para fila
      try {
        const currentConv = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          select: { status: true }
        });
        if (currentConv && currentConv.status === 'BOT') {
          logger.debug('[Webhook] Fallback: transferring conversation to queue after bot failure');
          await FlowEngine.transferToQueue(tenant, conversation, null);
        }
      } catch (fallbackErr) {
        logger.error('[Webhook] Fallback to queue also failed:', fallbackErr.message);
      }
    }
  }

  static async processStatus(tenant, status, io) {
    // Handle status updates (delivered, read, sent)
    const waId = status.id;
    const newStatus = status.status; // sent, delivered, read

    if (!waId) {
      return;
    }

    try {
      // Use findFirst to avoid Prisma engine-level P2025 error when message isn't tracked yet
      const message = await prisma.message.findFirst({
        where: { waId: waId }
      });

      if (!message) {
        // Message sent before tracking started — silently ignore
        return;
      }

      await prisma.message.update({
        where: { id: message.id },
        data: { status: newStatus }
      });

      if (io) {
        io.to(`tenant:${tenant.id}`).emit('message_status', {
          id: message.id,
          waId: waId,
          status: newStatus,
          conversationId: message.conversationId
        });
      }
    } catch (error) {
      logger.error('Error updating message status:', error);
    }
  }
}

module.exports = WebhookController;
