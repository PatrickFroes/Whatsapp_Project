/**
 * MediaController - Controla upload e envio de mídias
 */

const MediaService = const logger = require('../utils/logger');
const '../services/MediaService');
const prisma = require('../services/database');
const { getIO } = require('../services/socket');

class MediaController {
  /**
   * POST /api/media/upload - Upload e envio de mídia
   * Requer multer middleware para multipart/form-data
   */
  static async uploadAndSend(req, res) {
    try {
      const { phone, caption } = req.body;
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
        select: { id: true }
      });

      if (!tenant) {
        return res.status(400).json({ error: 'Tenant not found' });
      }

      // Upload para WhatsApp
      const mediaData = await MediaService.uploadToWhatsApp(
        file,
        tenant
      );

      // Enviar mensagem
      const waResponse = await MediaService.sendMediaMessage(
        phone,
        mediaData.mediaId,
        mediaData.mediaType,
        { caption, filename: mediaData.mediaFilename },
        tenant
      );

      // Encontrar ou criar contato/conversa
      let contact = await prisma.contact.findUnique({
        where: { tenantId_phone: { tenantId, phone } }
      });

      if (!contact) {
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
          data: {
            contactId: contact.id,
            tenantId,
            status: 'ASSIGNED',
            assignedToId: userId
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
      const { phone, mediaUrl, mediaType, caption, filename } = req.body;
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

      // Buscar tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(400).json({ error: 'Tenant not found' });
      }

      // Enviar
      const waResponse = await MediaService.sendMediaByUrl(
        phone,
        mediaUrl,
        mediaType,
        { caption, filename },
        tenant
      );

      // Salvar no banco
      let contact = await prisma.contact.findUnique({
        where: { tenantId_phone: { tenantId, phone } }
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: { tenantId, phone, name: phone }
        });
      }

      let conversation = await prisma.conversation.findFirst({
        where: {
          contactId: contact.id,
          tenantId: tenantId, // SECURITY: Explicit tenant isolation
          status: { notIn: ['RESOLVED', 'CLOSED'] }
        }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            contactId: contact.id,
            tenantId,
            status: 'ASSIGNED',
            assignedToId: userId
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
      const { phone, latitude, longitude, name, address } = req.body;
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

      const waResponse = await MediaService.sendLocation(
        phone,
        latitude,
        longitude,
        { name, address },
        tenant
      );

      // Salvar
      let contact = await prisma.contact.findUnique({
        where: { tenantId_phone: { tenantId, phone } }
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: { tenantId, phone, name: phone }
        });
      }

      let conversation = await prisma.conversation.findFirst({
        where: {
          contactId: contact.id,
          tenantId: tenantId, // SECURITY: Explicit tenant isolation
          status: { notIn: ['RESOLVED', 'CLOSED'] }
        }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            contactId: contact.id,
            tenantId,
            status: 'ASSIGNED',
            assignedToId: userId
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
   * GET /api/media/url/:mediaId - Obter URL real da mídia do WhatsApp
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

      // Buscar tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(400).json({ error: 'Tenant not found' });
      }

      // Baixar URL da mídia do WhatsApp
      const mediaData = await MediaService.downloadFromWhatsApp(mediaId, tenant);

      res.json({
        url: mediaData.url,
        mimeType: mediaData.mimeType,
        fileSize: mediaData.fileSize
      });
    } catch (error) {
      logger.error('Get media URL failed:', error);
      res.status(500).json({
        error: 'Failed to get media URL',
        details: error.message
      });
    }
  }
}

module.exports = MediaController;
