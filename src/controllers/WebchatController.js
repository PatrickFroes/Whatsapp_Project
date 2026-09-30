/**
 * WebchatController.js - Gerenciar conexões do Webchat do Tenant
 */

const logger = require('../utils/logger');
const prisma = require('../services/database');
const { logAuditEvent, AuditAction } = require('../services/auditLog.service');

class WebchatController {
  /**
   * GET /api/admin/webchat
   * Listar todas as conexões Webchat do tenant
   */
  static async getWebchatConnections(req, res) {
    try {
      const { tenantId } = req.user;

      const connections = await prisma.webchatConnection.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' }
      });

      res.json(connections);
    } catch (error) {
      logger.error('[WebchatController] GET error:', error);
      res.status(500).json({ error: 'Falha ao listar conexões do Webchat.' });
    }
  }

  /**
   * POST /api/admin/webchat
   * Criar ou atualizar uma conexão de Webchat
   */
  static async saveWebchatConnection(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id, name, status, welcomeMessage, allowedDomains, flowId } = req.validatedBody;

      // Verificar privilégios
      if (!['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(req.user.role)) {
        await logAuditEvent(AuditAction.UNAUTHORIZED_ACCESS, {
          userId,
          tenantId,
          resource: 'WebchatConnection',
          action: 'SAVE'
        });
        return res.status(403).json({ error: 'Não autorizado.' });
      }

      // Validar flowId se fornecido
      let validatedFlowId = flowId || null;
      if (validatedFlowId === '') {
        validatedFlowId = null;
      }

      if (validatedFlowId) {
        // Verifica se o fluxo pertence ao tenant
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId }
        });
        const flows = tenant.flows || {};
        if (!flows[validatedFlowId]) {
          return res.status(400).json({ error: 'Fluxo URA inválido para este tenant.' });
        }
      }

      let connection;

      if (id) {
        // Atualização
        const existing = await prisma.webchatConnection.findFirst({
          where: { id, tenantId }
        });

        if (!existing) {
          return res.status(404).json({ error: 'Conexão Webchat não encontrada.' });
        }

        connection = await prisma.webchatConnection.update({
          where: { id },
          data: {
            name,
            status: status || existing.status,
            welcomeMessage: welcomeMessage !== undefined ? welcomeMessage : existing.welcomeMessage,
            allowedDomains: allowedDomains || existing.allowedDomains,
            flowId: validatedFlowId
          }
        });

        await logAuditEvent(AuditAction.SETTINGS_UPDATE, {
          userId,
          tenantId,
          resource: 'WebchatConnection',
          resourceId: connection.id,
          details: { name }
        });
      } else {
        // Criação
        connection = await prisma.webchatConnection.create({
          data: {
            tenantId,
            name,
            status: status || 'CONNECTED',
            welcomeMessage: welcomeMessage || null,
            allowedDomains: allowedDomains || [],
            flowId: validatedFlowId
          }
        });

        await logAuditEvent(AuditAction.SETTINGS_UPDATE, {
          userId,
          tenantId,
          resource: 'WebchatConnection',
          resourceId: connection.id,
          details: { action: 'CREATE', name }
        });
      }

      res.json(connection);
    } catch (error) {
      logger.error('[WebchatController] SAVE error:', error);
      res.status(500).json({ error: 'Falha ao salvar conexão do Webchat.' });
    }
  }

  /**
   * DELETE /api/admin/webchat/:id
   * Excluir uma conexão de Webchat
   */
  static async deleteWebchatConnection(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { id } = req.params;

      if (!['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Não autorizado.' });
      }

      const existing = await prisma.webchatConnection.findFirst({
        where: { id, tenantId }
      });

      if (!existing) {
        return res.status(404).json({ error: 'Conexão Webchat não encontrada.' });
      }

      await prisma.webchatConnection.delete({
        where: { id }
      });

      await logAuditEvent(AuditAction.SETTINGS_UPDATE, {
        userId,
        tenantId,
        resource: 'WebchatConnection',
        resourceId: id,
        details: { action: 'DELETE', name: existing.name }
      });

      res.json({ success: true, message: 'Conexão Webchat excluída com sucesso.' });
    } catch (error) {
      logger.error('[WebchatController] DELETE error:', error);
      res.status(500).json({ error: 'Falha ao excluir conexão do Webchat.' });
    }
  }
}

module.exports = WebchatController;
