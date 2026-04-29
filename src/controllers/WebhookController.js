const logger = require('../utils/logger');
const prisma =
require('../services/database');
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
    let mediaSize = null; // Will be populated from media objects
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
      mediaSize = msg.image.size || null; // Extract size if available
    } else if (contentType === 'video') {
      content = msg.video.caption || '[Vídeo]';
      mediaUrl = msg.video.id;
      mediaMimeType = msg.video.mime_type;
      mediaFilename = msg.video.filename || 'video.mp4';
      mediaSize = msg.video.size || null;
    } else if (contentType === 'audio') {
      content = '[Áudio]';
      mediaUrl = msg.audio.id;
      mediaMimeType = msg.audio.mime_type;
      mediaFilename = 'audio.ogg';
      mediaSize = msg.audio.size || null;
    } else if (contentType === 'document') {
      content = msg.document.caption || '[Documento]';
      mediaUrl = msg.document.id;
      mediaMimeType = msg.document.mime_type;
      mediaFilename = msg.document.filename || 'document.pdf';
      mediaSize = msg.document.size || null;
    } else if (contentType === 'sticker') {
      content = '[Sticker]';
      mediaUrl = msg.sticker.id;
      mediaMimeType = msg.sticker.mime_type;
      mediaSize = msg.sticker.size || null;
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
        error: err.message,
        stack: err.stack
      });

      // Fallback with retry: Se bot falhou e a conversa ainda está em BOT, transfere para fila
      let fallbackSucceeded = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const currentConv = await prisma.conversation.findUnique({
            where: { id: conversation.id },
            select: { status: true, id: true }
          });

          if (!currentConv) {
            logger.error('[Webhook] Conversation disappeared during fallback attempt', {
              conversationId: conversation.id
            });
            break;
          }

          if (currentConv.status !== 'BOT') {
            logger.debug('[Webhook] Conversation already out of BOT status, no fallback needed', {
              currentStatus: currentConv.status
            });
            fallbackSucceeded = true;
            break;
          }

          logger.debug(`[Webhook] Fallback attempt ${attempt}/${maxRetries}: transferring to queue`, {
            conversationId: conversation.id
          });

          await FlowEngine.transferToQueue(tenant, conversation, null);
          fallbackSucceeded = true;
          logger.info('[Webhook] Fallback succeeded: conversation transferred to queue', {
            conversationId: conversation.id,
            attempt
          });
          break;
        } catch (fallbackErr) {
          logger.warn(`[Webhook] Fallback attempt ${attempt}/${maxRetries} failed:`, {
            conversationId: conversation.id,
            error: fallbackErr.message,
            attempt
          });

          // Wait before retry (exponential backoff: 100ms, 200ms, 400ms)
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
          }
        }
      }

      // Final fallback: Se todas as retries falharem, marca a conversa com status QUEUED manualmente
      if (!fallbackSucceeded) {
        logger.error('[Webhook] All fallback attempts failed - forcing manual queue assignment', {
          conversationId: conversation.id
        });

        try {
          // Forçar para QUEUED para que próximo webhook ou agente manual pegue
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              status: 'QUEUED',
              flowState: null,
              metadata: {
                ...conversation.metadata,
                botFailedAt: new Date().toISOString(),
                botError: err.message
              }
            }
          });

          logger.warn('[Webhook] Conversation forcibly moved to QUEUED', {
            conversationId: conversation.id
          });

          // Notificar supervisores via socket
          io?.to(`tenant:${tenant.id}`).emit('bot_failure_manual_queue', {
            conversationId: conversation.id,
            contactPhone: senderPhone,
            reason: 'Bot execution and automatic transfer both failed',
            timestamp: new Date()
          });
        } catch (manualQueueErr) {
          logger.error('[Webhook] CRITICAL: Even manual queue assignment failed!', {
            conversationId: conversation.id,
            error: manualQueueErr.message
          });
          // At this point conversation is stuck - needs manual intervention
        }
      }
    }
  }

  static async processStatus(tenant, status, io) {
    // Handle status updates (delivered, read, sent, failed)
    const waId = status.id;
    const newStatus = status.status; // sent, delivered, read, failed

    if (!waId) {
      logger.warn('[Webhook] Status update received without waId');
      return;
    }

    // Validate status enum
    const VALID_STATUSES = ['sent', 'delivered', 'read', 'failed'];
    if (!VALID_STATUSES.includes(newStatus)) {
      logger.warn('[Webhook] Invalid status received from Meta:', {
        waId,
        receivedStatus: newStatus,
        validStatuses: VALID_STATUSES
      });
      return;
    }

    try {
      // Use findFirst to avoid Prisma engine-level P2025 error when message isn't tracked yet
      const message = await prisma.message.findFirst({
        where: { waId: waId }
      });

      if (!message) {
        // Message sent before tracking started — silently ignore
        logger.debug('[Webhook] Status update for untracked message', {
          waId,
          status: newStatus
        });
        return;
      }

      // Don't downgrade status (read → delivered is invalid progression)
      const statusRank = { sent: 0, delivered: 1, read: 2, failed: -1 };
      const currentRank = statusRank[message.status] ?? 0;
      const newRank = statusRank[newStatus] ?? 0;

      if (newRank < currentRank && newStatus !== 'failed') {
        logger.warn('[Webhook] Invalid status progression - rejecting downgrade', {
          waId,
          currentStatus: message.status,
          attemptedStatus: newStatus
        });
        return;
      }

      // Update with timestamp when status changed
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: newStatus,
          statusUpdatedAt: new Date(),
          ...(newStatus === 'failed' && status.errors && {
            metadata: {
              ...message.metadata,
              failureReason: status.errors?.[0]?.message,
              failureCode: status.errors?.[0]?.code
            }
          })
        }
      });

      logger.debug('[Webhook] Message status updated', {
        waId,
        status: newStatus,
        messageId: message.id
      });

      if (io) {
        io.to(`tenant:${tenant.id}`).emit('message_status', {
          id: message.id,
          waId: waId,
          status: newStatus,
          conversationId: message.conversationId,
          timestamp: new Date()
        });
      }
    } catch (error) {
      logger.error('[Webhook] Error updating message status:', {
        waId,
        status: newStatus,
        error: error.message
      });
    }
  }
}

module.exports = WebhookController;
