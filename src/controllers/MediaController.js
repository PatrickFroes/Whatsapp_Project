/**
 * MediaController - Controla upload e envio de mídias
 */

const logger = require('../utils/logger');
const MediaService = require('../services/MediaService');
const prisma = require('../services/database');
const { getIO } = require('../services/socket');
const { validateExternalUrl } = require('../utils/ssrfGuard');

class MediaController {
  /**
   * POST /api/media/upload - Upload e envio de mídia
   * Requer multer middleware para multipart/form-data
   */
  static async uploadAndSend(req, res) {
    try {
      const { phone, caption, whatsappPhoneId, conversationId } = req.body;
      const { tenantId, userId } = req.user;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
      }

      // Buscar tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, limitStorageGb: true }
      });

      if (!tenant) {
        // Limpar arquivo temporário se houver erro
        const fs = require('fs');
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(400).json({ error: 'Tenant not found' });
      }

      // 🛡️ Validação de Limite de Espaço de Mídia (GB)
      const sumResult = await prisma.message.aggregate({
        where: {
          conversation: { tenantId },
          mediaSize: { not: null }
        },
        _sum: {
          mediaSize: true
        }
      });
      const currentUsageBytes = sumResult._sum.mediaSize || 0;
      const limitBytes = tenant.limitStorageGb * 1024 * 1024 * 1024;

      if (tenant.limitStorageGb > 0 && (currentUsageBytes + file.size) > limitBytes) {
        const fs = require('fs');
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(403).json({
          error: `Limite de espaço para mídias atingido. Contratado: ${tenant.limitStorageGb} GB. Uso atual: ${(currentUsageBytes / (1024 * 1024 * 1024)).toFixed(3)} GB.`
        });
      }

      // Load target config phone ID
      let targetPhoneId = whatsappPhoneId;
      if (!targetPhoneId && conversationId) {
        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { whatsappPhoneId: true }
        });
        if (conv) {
          targetPhoneId = conv.whatsappPhoneId;
        }
      }

      if (!targetPhoneId) {
        const firstConfig = await prisma.configuration.findFirst({
          where: { tenantId }
        });
        if (firstConfig) {
          targetPhoneId = firstConfig.phoneNumberId;
        }
      }

      const tenantObj = { id: tenantId, whatsappPhoneId: targetPhoneId };

      // Upload para WhatsApp
      const mediaData = await MediaService.uploadToWhatsApp(
        file,
        tenantObj
      );

      // Enviar mensagem
      const waResponse = await MediaService.sendMediaMessage(
        phone,
        mediaData.mediaId,
        mediaData.mediaType,
        { caption, filename: mediaData.mediaFilename },
        tenantObj
      );

      // Encontrar ou criar contato/conversa
      const { getBrPhoneOptions } = require('../utils/validators');
      const phoneOptions = getBrPhoneOptions(phone);

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
        if (targetPhoneId) {
          convWhere.whatsappPhoneId = targetPhoneId;
        }
      }

      let conversation = await prisma.conversation.findFirst({
        where: convWhere,
        include: {
          contact: true
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      if (conversation && conversation.assignedToId !== userId && req.user.role === 'AGENT') {
        return res.status(403).json({
          error: 'Acesso negado',
          details: 'Você não pode interagir com conversas que não estão atribuídas a você.'
        });
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
          contact = await prisma.contact.create({
            data: { tenantId, phone, name: phone }
          });
        }

        conversation = await prisma.conversation.create({
          data: {
            contactId: contact.id,
            tenantId,
            status: 'ASSIGNED',
            assignedToId: userId,
            whatsappPhoneId: targetPhoneId
          }
        });
      }

      // Salvar mensagem
      // mediaUrl será o ID do WhatsApp temporariamente até baixarmos a URL real
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content:
            caption ||
            (mediaData.mediaType === 'image'
              ? '[Imagem]'
              : mediaData.mediaType === 'video'
                ? '[Vídeo]'
                : mediaData.mediaType === 'audio'
                  ? '[Áudio]'
                  : mediaData.mediaType === 'document'
                    ? '[Documento]'
                    : `[${mediaData.mediaType.toUpperCase()}]`),
          contentType: mediaData.mediaType,
          mediaUrl: mediaData.mediaId, // ID do WhatsApp
          mediaSize: mediaData.mediaSize,
          mediaMimeType: mediaData.mediaMimeType,
          mediaFilename: mediaData.mediaFilename,
          direction: 'OUTBOUND',
          senderId: userId,
          waId: waResponse.messages?.[0]?.id
        }
      });

      // Atualizar conversa
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
      });

      // Emitir via Socket.io - Conversation room (privado)
      const io = getIO();
      io.to(`conversation:${conversation.id}`).emit('message_sent', {
        conversationId: conversation.id,
        message,
        phone
      });

      res.json({
        success: true,
        message,
        waResponse
      });
    } catch (error) {
      logger.error('Media upload/send failed:', error);
      res.status(500).json({
        error: 'Failed to upload/send media',
        details: error.message
      });
    }
  }

  /**
   * POST /api/media/send-url - Envia mídia por URL (sem upload)
   */
  static async sendByUrl(req, res) {
    try {
      const { phone, mediaUrl, mediaType, caption, filename, whatsappPhoneId, conversationId } = req.body;
      const { tenantId, userId } = req.user;

      if (!phone || !mediaUrl || !mediaType) {
        return res.status(400).json({
          error: 'Phone, mediaUrl and mediaType are required'
        });
      }

      // Validar mediaType
      const validTypes = ['image', 'video', 'audio', 'document'];
      if (!validTypes.includes(mediaType)) {
        return res.status(400).json({
          error: `Invalid mediaType. Must be one of: ${validTypes.join(', ')}`
        });
      }

      // Proteção SSRF: validar a URL de mídia fornecida pelo usuário
      const urlCheck = validateExternalUrl(mediaUrl);
      if (!urlCheck.valid) {
        logger.warn('[MediaController] SSRF attempt blocked', {
          reason: urlCheck.reason,
          userId,
          tenantId
        });
        return res.status(400).json({ error: 'URL de mídia inválida ou não permitida' });
      }

      // Buscar tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(400).json({ error: 'Tenant not found' });
      }

      // Load target config phone ID
      let targetPhoneId = whatsappPhoneId;
      if (!targetPhoneId && conversationId) {
        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { whatsappPhoneId: true }
        });
        if (conv) {
          targetPhoneId = conv.whatsappPhoneId;
        }
      }

      if (!targetPhoneId) {
        const firstConfig = await prisma.configuration.findFirst({
          where: { tenantId }
        });
        if (firstConfig) {
          targetPhoneId = firstConfig.phoneNumberId;
        }
      }

      const tenantObj = { id: tenantId, whatsappPhoneId: targetPhoneId };

      // Enviar
      const waResponse = await MediaService.sendMediaByUrl(
        phone,
        mediaUrl,
        mediaType,
        { caption, filename },
        tenantObj
      );

      // Salvar no banco
      const { getBrPhoneOptions } = require('../utils/validators');
      const phoneOptions = getBrPhoneOptions(phone);

      const convWhere = {
        tenantId: tenantId, // SECURITY: Explicit tenant isolation
        status: { notIn: ['RESOLVED', 'CLOSED'] }
      };

      if (conversationId) {
        convWhere.id = conversationId;
      } else {
        convWhere.contact = { phone: { in: phoneOptions } };
        if (targetPhoneId) {
          convWhere.whatsappPhoneId = targetPhoneId;
        }
      }

      let conversation = await prisma.conversation.findFirst({
        where: convWhere,
        include: {
          contact: true
        }
      });

      if (conversation && conversation.assignedToId !== userId && req.user.role === 'AGENT') {
        return res.status(403).json({
          error: 'Acesso negado',
          details: 'Você não pode interagir com conversas que não estão atribuídas a você.'
        });
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
          contact = await prisma.contact.create({
            data: { tenantId, phone, name: phone }
          });
        }

        conversation = await prisma.conversation.create({
          data: {
            contactId: contact.id,
            tenantId,
            status: 'ASSIGNED',
            assignedToId: userId,
            whatsappPhoneId: targetPhoneId
          }
        });
      }

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content: caption || `[${mediaType.toUpperCase()}]`,
          contentType: mediaType,
          mediaUrl,
          direction: 'OUTBOUND',
          senderId: userId,
          waId: waResponse.messages?.[0]?.id
        }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
      });

      const io = getIO();
      io.to(`conversation:${conversation.id}`).emit('message_sent', {
        ...message,
        conversationId: conversation.id
      });

      res.json({ success: true, message });
    } catch (error) {
      logger.error('Send media by URL failed:', error);
      res.status(500).json({
        error: 'Failed to send media',
        details: error.message
      });
    }
  }

  /**
   * POST /api/media/location - Envia localização
   */
  static async sendLocation(req, res) {
    try {
      const { phone, latitude, longitude, name, address, whatsappPhoneId, conversationId } = req.body;
      const { tenantId, userId } = req.user;

      if (!phone || !latitude || !longitude) {
        return res.status(400).json({
          error: 'Phone, latitude and longitude are required'
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(400).json({ error: 'Tenant not found' });
      }

      // Load target config phone ID
      let targetPhoneId = whatsappPhoneId;
      if (!targetPhoneId && conversationId) {
        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { whatsappPhoneId: true }
        });
        if (conv) {
          targetPhoneId = conv.whatsappPhoneId;
        }
      }

      if (!targetPhoneId) {
        const firstConfig = await prisma.configuration.findFirst({
          where: { tenantId }
        });
        if (firstConfig) {
          targetPhoneId = firstConfig.phoneNumberId;
        }
      }

      const tenantObj = { id: tenantId, whatsappPhoneId: targetPhoneId };

      const waResponse = await MediaService.sendLocation(
        phone,
        latitude,
        longitude,
        { name, address },
        tenantObj
      );

      // Salvar
      const { getBrPhoneOptions } = require('../utils/validators');
      const phoneOptions = getBrPhoneOptions(phone);

      const convWhere = {
        tenantId: tenantId, // SECURITY: Explicit tenant isolation
        status: { notIn: ['RESOLVED', 'CLOSED'] }
      };

      if (conversationId) {
        convWhere.id = conversationId;
      } else {
        convWhere.contact = { phone: { in: phoneOptions } };
        if (targetPhoneId) {
          convWhere.whatsappPhoneId = targetPhoneId;
        }
      }

      let conversation = await prisma.conversation.findFirst({
        where: convWhere,
        include: {
          contact: true
        }
      });

      if (conversation && conversation.assignedToId !== userId && req.user.role === 'AGENT') {
        return res.status(403).json({
          error: 'Acesso negado',
          details: 'Você não pode interagir com conversas que não estão atribuídas a você.'
        });
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
          contact = await prisma.contact.create({
            data: { tenantId, phone, name: phone }
          });
        }

        conversation = await prisma.conversation.create({
          data: {
            contactId: contact.id,
            tenantId,
            status: 'ASSIGNED',
            assignedToId: userId,
            whatsappPhoneId: targetPhoneId
          }
        });
      }

      const locationData = {
        latitude,
        longitude,
        name: name || null,
        address: address || null
      };

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content: JSON.stringify(locationData),
          contentType: 'location',
          direction: 'OUTBOUND',
          senderId: userId,
          waId: waResponse.messages?.[0]?.id
        }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
      });

      const io = getIO();
      io.to(`conversation:${conversation.id}`).emit('message_sent', {
        ...message,
        conversationId: conversation.id
      });

      res.json({ success: true, message });
    } catch (error) {
      logger.error('Send location failed:', error);
      res.status(500).json({
        error: 'Failed to send location',
        details: error.message
      });
    }
  }

  /**
   * GET /api/media/url/:mediaId - Obter URL local de proxy de mídia do WhatsApp
   */
  static async getMediaUrl(req, res) {
    try {
      const { mediaId } = req.params;
      const { tenantId } = req.user;

      // Verificar se a mídia pertence a uma mensagem do tenant
      const message = await prisma.message.findFirst({
        where: {
          mediaUrl: mediaId,
          conversation: {
            tenantId
          }
        }
      });

      if (!message) {
        return res.status(404).json({ error: 'Media not found or access denied' });
      }

      // Extrair token cru do request atual para repassar na URL da mídia
      const authHeader = req.headers['authorization'];
      let token = authHeader && authHeader.split(' ')[1];
      if (!token && req.cookies && req.cookies.auth_token) {
        token = require('../utils/crypto').decrypt(req.cookies.auth_token) || req.cookies.auth_token;
      }
      if (!token && req.query && req.query.token) {
        token = req.query.token;
      }

      // Retorna a rota do nosso próprio proxy local de mídia com o token de autenticação
      const localUrl = `/api/media/download/${mediaId}?token=${token || ''}`;

      res.json({
        url: localUrl,
        mimeType: message.mediaMimeType || 'audio/ogg',
        fileSize: message.mediaSize || 0
      });
    } catch (error) {
      logger.error('Get media URL failed:', error);
      res.status(500).json({
        error: 'Failed to get media URL',
        details: error.message
      });
    }
  }

  /**
   * GET /api/media/download/:mediaId - Stream/Download do binário do arquivo de mídia
   */
  static async downloadMediaFile(req, res) {
    try {
      const { mediaId } = req.params;

      // Buscar a mensagem associada para descobrir o tenant
      const message = await prisma.message.findFirst({
        where: {
          mediaUrl: mediaId
        },
        include: {
          conversation: true
        }
      });

      if (!message || !message.conversation) {
        return res.status(404).send('Mídia não encontrada.');
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: message.conversation.tenantId }
      });

      if (!tenant) {
        return res.status(404).send('Tenant não encontrado.');
      }

      const MediaService = require('../services/MediaService');
      const mediaData = await MediaService.downloadFromWhatsApp(mediaId, tenant);

      // Definir headers e enviar o binário
      res.set({
        'Content-Type': mediaData.mimeType,
        'Content-Length': mediaData.fileSize || mediaData.buffer.length,
        'Cache-Control': 'public, max-age=86400' // Cache por 1 dia no browser
      });

      return res.send(mediaData.buffer);
    } catch (error) {
      logger.error('Failed to stream media file:', error);
      res.status(500).send('Failed to stream media file: ' + error.message);
    }
  }
}

module.exports = MediaController;
