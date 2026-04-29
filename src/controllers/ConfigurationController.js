/**
 * ConfigurationController.js - Gerenciar configurações de API
 *
 * Responsável por:
 * - Obter configurações atuais
 * - Salvar novas configurações
 * - Validar credenciais
 */

const logger = require('../utils/logger');
const prisma =
require('../services/database');
const axios = require('axios');
const { logAuditEvent, AuditAction } = require('../services/auditLog.service');

class ConfigurationController {
  /**
   * GET /api/admin/configuration
   * Obter status de configuração (NÃO retorna valores sensíveis)
   * Frontend responsável por deixar campos vazios se admin precisar editar
   */
  static async getConfiguration(req, res) {
    try {
      const { tenantId } = req.user;

      const config = await prisma.configuration.findUnique({
        where: { tenantId }
      });

      if (!config) {
        return res.status(404).json({ error: 'Configuration not found' });
      }

      // Retorna APENAS status - valores sensíveis nunca saem do servidor
      const statusOnly = {
        tenantId: config.tenantId,
        isConfigured: {
          phoneNumberId: !!config.phoneNumberId,
          verifyToken: !!config.verifyToken,
          whatsappToken: !!config.whatsappToken,
          metaAppSecret: !!config.metaAppSecret,
          allRequired: !!(
            config.phoneNumberId &&
            config.verifyToken &&
            config.whatsappToken &&
            config.metaAppSecret
          )
        },
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy
      };

      res.json(statusOnly);
    } catch (error) {
      logger.error('[Configuration] GET error:', error);
      res.status(500).json({ error: 'Failed to fetch configuration' });
    }
  }

  /**
   * POST /api/admin/configuration
   * Salvar/atualizar configurações
   */
  static async saveConfiguration(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { phoneNumberId, verifyToken, whatsappToken, metaAppSecret } = req.validatedBody;

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

      // Estrutura de atualização - NUNCA sobrescrever com undefined
      // Se campo vem vazio/null, mantém valor anterior
      const updateData = {
        updatedBy: userId,
        updatedAt: new Date()
      };

      // Apenas atualizar campos que vêm preenchidos
      if (phoneNumberId) updateData.phoneNumberId = phoneNumberId;
      if (verifyToken) updateData.verifyToken = verifyToken;
      if (whatsappToken) updateData.whatsappToken = whatsappToken;
      if (metaAppSecret) updateData.metaAppSecret = metaAppSecret;

      // Atualizar tanto Configuration quanto Tenant em transação
      const [config, updatedTenant] = await prisma.$transaction([
        // Atualizar ou criar configuração
        prisma.configuration.upsert({
          where: { tenantId },
          update: updateData,
          create: {
            tenantId,
            phoneNumberId,
            verifyToken,
            whatsappToken,
            metaAppSecret,
            updatedBy: userId
          }
        }),
        // Sincronizar Tenant.waPhoneId com Configuration.phoneNumberId
        // Busca config atualizada e sincroniza
        prisma.tenant.update({
          where: { id: tenantId },
          data: {
            waPhoneId: phoneNumberId || null
          }
        })
      ]);

      // Verificar se sincronização funcionou
      if (phoneNumberId && updatedTenant.waPhoneId !== phoneNumberId) {
        logger.warn(
          `[Configuration] Sync warning: waPhoneId (${updatedTenant.waPhoneId}) !== phoneNumberId (${phoneNumberId})`
        );
        return res.status(500).json({
          error: 'Synchronization failed',
          details: 'waPhoneId could not be synchronized'
        });
      }

      // Log audit
      await logAuditEvent(AuditAction.UPDATE_SETTINGS, {
        userId,
        tenantId,
        resource: 'Configuration',
        resourceId: tenantId,
        success: true,
        details: {
          fieldsUpdated: [
            phoneNumberId ? 'phoneNumberId' : null,
            verifyToken ? 'verifyToken' : null,
            whatsappToken ? 'whatsappToken' : null,
            metaAppSecret ? 'metaAppSecret' : null
          ].filter(Boolean)
        }
      });

      // Responder com status apenas
      res.json({
        message: 'Configuration saved and synchronized successfully',
        isConfigured: {
          phoneNumberId: !!config.phoneNumberId,
          verifyToken: !!config.verifyToken,
          whatsappToken: !!config.whatsappToken,
          metaAppSecret: !!config.metaAppSecret,
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

      res.status(500).json({ error: 'Failed to save configuration' });
    }
  }

  /**
   * POST /api/admin/configuration/validate
   * Validar se credenciais funcionam
   */
  static async validateConfiguration(req, res) {
    try {
      const { tenantId } = req.user;

      const config = await prisma.configuration.findUnique({
        where: { tenantId }
      });

      if (!config) {
        return res.status(404).json({ error: 'Configuration not found' });
      }

      // Verificar se todos os campos obrigatórios estão preenchidos
      const missing = [];
      if (!config.phoneNumberId) {
        missing.push('phoneNumberId');
      }
      if (!config.verifyToken) {
        missing.push('verifyToken');
      }
      if (!config.whatsappToken) {
        missing.push('whatsappToken');
      }
      if (!config.metaAppSecret) {
        missing.push('metaAppSecret');
      }

      if (missing.length > 0) {
        return res.status(400).json({
          valid: false,
          missingFields: missing,
          message: `Campos obrigatórios não configurados: ${missing.join(', ')}`
        });
      }

      // Validação real na Meta Graph API.
      const graphApiUrl = `https://graph.facebook.com/v23.0/${config.phoneNumberId}`;

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

        return res.json({
          valid: true,
          message: 'Configuration validated against Meta API',
          lastValidated: new Date(),
          meta: {
            displayPhoneNumber: phoneData.display_phone_number || null,
            verifiedName: phoneData.verified_name || null,
            qualityRating: phoneData.quality_rating || null
          },
          fieldsConfigured: {
            phoneNumberId: true,
            verifyToken: true,
            whatsappToken: true,
            metaAppSecret: true
          }
        });
      } catch (metaError) {
        const status = metaError.response?.status;
        const message = metaError.response?.data?.error?.message || metaError.message;

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
