const prisma = require('../services/database');
const logger = require('../utils/logger');
const FlowEngine = require('../services/FlowEngine');
const TelegramService = require('../services/TelegramService');

class TelegramWebhookController {
  /**
   * Recebe e processa eventos/mensagens enviados pelo Telegram
   * POST /api/webhooks/telegram/:tenantId
   */
  static async handleWebhook(req, res) {
    // Responder imediatamente 200 OK ao Telegram para evitar retransmissões
    res.status(200).send('OK');

    try {
      const { tenantId } = req.params;
      const update = req.body;

      if (!update || (!update.message && !update.callback_query)) {
        return;
      }

      // Buscar Tenant e configuração do Telegram
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });

      if (!tenant || !tenant.active) {
        logger.warn(`[TelegramWebhook] Tenant inválido ou inativo: ${tenantId}`);
        return;
      }

      const telegramConfig = tenant.telegramConfig || {};
      if (!telegramConfig.enabled || !telegramConfig.botToken) {
        logger.warn(`[TelegramWebhook] Canal Telegram desativado para o tenant: ${tenantId}`);
        return;
      }

      const botToken = telegramConfig.botToken;

      // Normalizar mensagem do update
      let message = update.message;
      let isCallback = false;
      let callbackData = null;

      if (update.callback_query) {
        isCallback = true;
        message = update.callback_query.message;
        callbackData = update.callback_query.data;
      }

      if (!message || !message.chat) {
        return;
      }

      const chatId = String(message.chat.id);
      const phone = `tg_${chatId}`;
      const fromUser = isCallback ? update.callback_query.from : message.from;

      let senderName = '';
      if (fromUser) {
        const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ');
        const username = fromUser.username ? ` (@${fromUser.username})` : '';
        senderName = (fullName + username).trim() || 'Usuário Telegram';
      } else {
        senderName = 'Usuário Telegram';
      }

      // Extrair conteúdo e tipo de mídia
      let textContent = isCallback ? callbackData : (message.text || message.caption || '');
      let contentType = 'text';
      let mediaUrl = null;
      let mediaFilename = null;

      if (message.photo && message.photo.length > 0) {
        contentType = 'image';
        const largestPhoto = message.photo[message.photo.length - 1];
        mediaUrl = await TelegramService.getFileUrl(botToken, largestPhoto.file_id);
      } else if (message.document) {
        contentType = 'document';
        mediaFilename = message.document.file_name || 'documento';
        mediaUrl = await TelegramService.getFileUrl(botToken, message.document.file_id);
      } else if (message.voice || message.audio) {
        contentType = 'audio';
        const audioObj = message.voice || message.audio;
        mediaUrl = await TelegramService.getFileUrl(botToken, audioObj.file_id);
      } else if (message.video) {
        contentType = 'video';
        mediaUrl = await TelegramService.getFileUrl(botToken, message.video.file_id);
      }

      // 1. Buscar ou criar o Contact
      let contact = await prisma.contact.findFirst({
        where: {
          tenantId,
          phone
        }
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            tenantId,
            phone,
            name: senderName
          }
        });
      } else if (senderName && contact.name !== senderName) {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: { name: senderName }
        });
      }

      // 2. Buscar ou criar a Conversation ativa
      let conversation = await prisma.conversation.findFirst({
        where: {
          tenantId,
          contactId: contact.id,
          status: { notIn: ['RESOLVED', 'CLOSED'] }
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      const isNewConversation = !conversation;

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            tenantId,
            contactId: contact.id,
            status: 'BOT',
            channel: 'TELEGRAM',
            unreadCount: 1,
            initiationType: 'INBOUND',
            lastMessageAt: new Date()
          }
        });
      } else {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: new Date(),
            unreadCount: { increment: 1 }
          }
        });
      }

      // 3. Salvar Mensagem INBOUND
      const savedMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'INBOUND',
          content: textContent || (contentType !== 'text' ? `[${contentType.toUpperCase()}]` : ''),
          contentType,
          mediaUrl,
          mediaFilename,
          status: 'RECEIVED'
        }
      });

      // 4. Emitir evento via WebSocket para o painel dos atendentes e supervisores
      if (req.io) {
        req.io.to(`conversation:${conversation.id}`).emit('new_message', savedMessage);
        req.io.to(`tenant:${tenantId}`).emit('chat_list_update', {
          conversationId: conversation.id,
          phone,
          lastMessage: savedMessage.content,
          channel: 'TELEGRAM'
        });
      }

      // 5. Se estiver em status BOT, processar pela URA / FlowEngine
      if (conversation.status === 'BOT') {
        const flowId = telegramConfig.flowId || tenant.defaultFlowId || null;
        try {
          await FlowEngine.processMessage({
            tenantId,
            conversationId: conversation.id,
            contactId: contact.id,
            phone,
            channel: 'TELEGRAM',
            text: textContent,
            flowId,
            botToken,
            chatId
          });
        } catch (flowErr) {
          logger.error('[TelegramWebhook] Erro no FlowEngine:', flowErr);
        }
      }
    } catch (error) {
      logger.error('[TelegramWebhook] Erro geral ao processar webhook do Telegram:', error);
    }
  }
}

module.exports = TelegramWebhookController;
