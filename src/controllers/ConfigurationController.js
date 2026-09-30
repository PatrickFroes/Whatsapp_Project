/**
 * ConfigurationController.js - Gerenciar configurações de API
 *
 * Responsável por:
 * - Obter configurações atuais (múltiplas)
 * - Salvar/Atualizar configurações
 * - Validar credenciais específicas por conexão
 * - Deletar conexões
 */

const logger = require('../utils/logger');
const prisma = require('../services/database');
const axios = require('axios');
const { logAuditEvent, AuditAction } = require('../services/auditLog.service');

class ConfigurationController {
  /**
   * GET /api/admin/configuration
   * Obter lista de configurações do tenant (NÃO retorna valores sensíveis)
   */
  static async getConfiguration(req, res) {
    try {
      const { tenantId } = req.user;

      const configs = await prisma.configuration.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' }
      });

      // Retorna APENAS status - valores sensíveis nunca saem do servidor
      const formatted = configs.map(config => ({
        id: config.id,
        tenantId: config.tenantId,
        name: config.name,
        status: config.status,
        phoneNumberId: config.phoneNumberId,
        verifyToken: config.verifyToken ? '••••••••' : null,
        whatsappToken: config.whatsappToken ? '••••••••' : null,
        metaAppSecret: config.metaAppSecret ? '••••••••' : null,
        wabaId: config.wabaId,
        isConfigured: {
          phoneNumberId: !!config.phoneNumberId,
          verifyToken: !!config.verifyToken,
          whatsappToken: !!config.whatsappToken,
          metaAppSecret: !!config.metaAppSecret,
          wabaId: !!config.wabaId,
          allRequired: !!(
            config.phoneNumberId &&
            config.verifyToken &&
            config.whatsappToken &&
            config.metaAppSecret
          )
        },
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy
      }));

      res.json(formatted);
    } catch (error) {
      logger.error('[Configuration] GET error:', error);
      res.status(500).json({ error: 'Failed to fetch configuration list' });
    }
  }

  /**
   * POST /api/admin/configuration
   * Salvar/atualizar configurações
   */
  static async saveConfiguration(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id, name, status, phoneNumberId, verifyToken, whatsappToken, metaAppSecret, wabaId } = req.validatedBody;

      // Verificar permissão de ADMIN ou OWNER
      if (!['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(req.user.role)) {
        await logAuditEvent(AuditAction.UNAUTHORIZED_ACCESS, {
          userId,
          tenantId,
          resource: 'Configuration',
          resourceId: tenantId,
          success: false,
          details: { reason: 'Insufficient permissions' }
        });
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Validar se phoneNumberId já é usado por outro tenant
      if (phoneNumberId) {
        const existing = await prisma.configuration.findFirst({
          where: {
            phoneNumberId,
            id: id ? { not: id } : undefined,
            tenantId: { not: tenantId }
          }
        });

        if (existing) {
          return res.status(409).json({
            error: 'Validation failed',
            details: 'phoneNumberId is already in use by another tenant'
          });
        }
      }

      const updateData = {
        updatedBy: userId,
        updatedAt: new Date()
      };

      if (name) { updateData.name = name; }
      if (status) { updateData.status = status; }
      if (phoneNumberId) { updateData.phoneNumberId = phoneNumberId; }
      if (verifyToken) { updateData.verifyToken = verifyToken; }
      if (whatsappToken) { updateData.whatsappToken = whatsappToken; }
      if (metaAppSecret) { updateData.metaAppSecret = metaAppSecret; }
      if (wabaId !== undefined) { updateData.wabaId = wabaId; }

      let config;
      if (id) {
        // Update existing connection
        config = await prisma.configuration.update({
          where: { id, tenantId },
          data: updateData
        });
      } else {
        // Create new connection
        const count = await prisma.configuration.count({ where: { tenantId } });
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { limitWhatsappConnections: true }
        });
        if (tenant && count >= tenant.limitWhatsappConnections) {
          return res.status(403).json({
            error: `Limite de conexões de WhatsApp atingido (${tenant.limitWhatsappConnections} conexões contratadas).`
          });
        }
        config = await prisma.configuration.create({
          data: {
            tenantId,
            name: name || `Conexão ${count + 1}`,
            status: status || 'CONNECTED',
            phoneNumberId: phoneNumberId || null,
            verifyToken: verifyToken || null,
            whatsappToken: whatsappToken || null,
            metaAppSecret: metaAppSecret || null,
            wabaId: wabaId || null,
            updatedBy: userId
          }
        });
      }

      // Log audit
      await logAuditEvent(AuditAction.UPDATE_SETTINGS, {
        userId,
        tenantId,
        resource: 'Configuration',
        resourceId: config.id,
        success: true,
        details: {
          fieldsUpdated: Object.keys(updateData).filter(k => k !== 'updatedBy' && k !== 'updatedAt')
        }
      });

      res.json({
        message: 'Configuration saved successfully',
        id: config.id,
        isConfigured: {
          phoneNumberId: !!config.phoneNumberId,
          verifyToken: !!config.verifyToken,
          whatsappToken: !!config.whatsappToken,
          metaAppSecret: !!config.metaAppSecret,
          wabaId: !!config.wabaId,
          allRequired: !!(
            config.phoneNumberId &&
            config.verifyToken &&
            config.whatsappToken &&
            config.metaAppSecret
          )
        }
      });
    } catch (error) {
      logger.error('[Configuration] SAVE error:', error);

      if (error.name === 'ZodError') {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors
        });
      }

      // Unique constraint violation on phoneNumberId
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: 'Validation failed',
          details: 'phoneNumberId already in use'
        });
      }

      res.status(500).json({ error: 'Failed to save configuration' });
    }
  }

  /**
   * DELETE /api/admin/configuration/:id
   * Deletar uma conexão específica
   */
  static async deleteConfiguration(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      if (!['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Evitar que delete a última conexão ativa do tenant
      const count = await prisma.configuration.count({ where: { tenantId } });
      if (count <= 1) {
        return res.status(400).json({
          error: 'Failed to delete',
          details: 'Não é possível remover a única conexão ativa de WhatsApp. Cadastre outra antes de excluir esta.'
        });
      }

      await prisma.configuration.delete({
        where: { id, tenantId }
      });

      // Log audit
      await logAuditEvent(AuditAction.UPDATE_SETTINGS, {
        userId,
        tenantId,
        resource: 'Configuration',
        resourceId: id,
        success: true,
        details: { action: 'delete_connection' }
      });

      res.json({ message: 'Configuration deleted successfully' });
    } catch (error) {
      logger.error('[Configuration] DELETE error:', error);
      res.status(500).json({ error: 'Failed to delete configuration' });
    }
  }

  /**
   * POST /api/admin/configuration/validate
   * Validar se credenciais funcionam
   */
  static async validateConfiguration(req, res) {
    try {
      const { tenantId } = req.user;
      const { id } = req.body || req.query;

      let config;
      if (id) {
        config = await prisma.configuration.findFirst({
          where: { id, tenantId }
        });
      } else {
        config = await prisma.configuration.findFirst({
          where: { tenantId }
        });
      }

      if (!config) {
        return res.status(404).json({ error: 'Configuration not found' });
      }

      const missing = [];
      if (!config.phoneNumberId) { missing.push('phoneNumberId'); }
      if (!config.verifyToken) { missing.push('verifyToken'); }
      if (!config.whatsappToken) { missing.push('whatsappToken'); }
      if (!config.metaAppSecret) { missing.push('metaAppSecret'); }

      if (missing.length > 0) {
        return res.status(400).json({
          valid: false,
          missingFields: missing,
          message: `Campos obrigatórios não configurados: ${missing.join(', ')}`
        });
      }

      const graphApiUrl = `https://graph.facebook.com/v18.0/${config.phoneNumberId}`;

      try {
        const graphResponse = await axios.get(graphApiUrl, {
          params: {
            fields: 'id,display_phone_number,verified_name,quality_rating'
          },
          headers: {
            Authorization: `Bearer ${config.whatsappToken}`
          },
          timeout: 15000
        });

        const phoneData = graphResponse.data || {};
        const idMatches = String(phoneData.id || '') === String(config.phoneNumberId);

        if (!idMatches) {
          return res.status(400).json({
            valid: false,
            message: 'Meta API respondeu com phone_number_id diferente do configurado'
          });
        }

        // Marcar conexão como CONNECTED
        await prisma.configuration.update({
          where: { id: config.id },
          data: { status: 'CONNECTED' }
        });

        return res.json({
          valid: true,
          message: 'Configuration validated against Meta API',
          lastValidated: new Date(),
          meta: {
            displayPhoneNumber: phoneData.display_phone_number || null,
            verifiedName: phoneData.verified_name || null,
            qualityRating: phoneData.quality_rating || null
          }
        });
      } catch (metaError) {
        const status = metaError.response?.status;
        const message = metaError.response?.data?.error?.message || metaError.message;

        // Marcar conexão como ERROR
        await prisma.configuration.update({
          where: { id: config.id },
          data: { status: 'ERROR' }
        });

        return res.status(400).json({
          valid: false,
          message: 'Meta API validation failed',
          details: {
            status: status || null,
            error: message
          }
        });
      }
    } catch (error) {
      logger.error('[Configuration] VALIDATE error:', error);
      res.status(500).json({ error: 'Failed to validate configuration' });
    }
  }
}

module.exports = ConfigurationController;
