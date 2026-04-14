/**
 * auditLog.service.js - Serviço de auditoria que registra ações críticas
 * Rastreia: login, logout, permissions, data changes, deletions
 */

const prisma = require('./database');
const logger = require('../utils/logger');

/**
 * Enum de ações auditáveis
 */
const AuditAction = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  REGISTER: 'REGISTER',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  ROLE_CHANGE: 'ROLE_CHANGE',
  PERMISSIONS_GRANT: 'PERMISSIONS_GRANT',
  PERMISSIONS_REVOKE: 'PERMISSIONS_REVOKE',
  TENANT_UPDATE: 'TENANT_UPDATE',
  TENANT_DELETE: 'TENANT_DELETE',
  MESSAGE_SEND: 'MESSAGE_SEND',
  MESSAGE_DELETE: 'MESSAGE_DELETE',
  CONVERSATION_CLOSE: 'CONVERSATION_CLOSE',
  DATA_EXPORT: 'DATA_EXPORT',
  DATA_DELETE: 'DATA_DELETE',
  API_KEY_CREATE: 'API_KEY_CREATE',
  API_KEY_REVOKE: 'API_KEY_REVOKE',
  CONFIG_CHANGE: 'CONFIG_CHANGE',
  ADMIN_ACTION: 'ADMIN_ACTION'
};

/**
 * Log uma ação auditável
 * @param {string} action - Ação realizada
 * @param {object} context - Contexto da ação
 */
async function logAuditEvent(action, context) {
  try {
    const {
      userId,
      tenantId,
      resource,
      resourceId,
      changes,
      ipAddress,
      userAgent,
      correlationId,
      success,
      details
    } = context;

    // Validar ação
    if (!Object.values(AuditAction).includes(action)) {
      logger.warn(`[AuditLog] Unknown action: ${action}`);
      return;
    }

    // Não registra em banco se está em teste
    if (process.env.NODE_ENV === 'test') {
      logger.debug(`[AuditLog] ${action}`, context);
      return;
    }

    // Log estruturado
    const auditEntry = {
      action,
      userId,
      tenantId,
      resource,
      resourceId,
      changes: changes ? JSON.stringify(changes) : null,
      ipAddress,
      userAgent: userAgent?.substring(0, 255) || null,
      correlationId,
      success: success !== false,
      details: details ? JSON.stringify(details) : null,
      timestamp: new Date()
    };

    // Enviar para log imediatamente
    const level = success === false ? 'error' : 'info';
    logger[level](`[AuditLog] ${action}`, {
      userId,
      tenantId,
      resourceId,
      correlationId
    });

    // Salvar em banco (async, não bloqueia resposta)
    // Note: Em produção, seria melhor usar uma fila (Redis, RabbitMQ)
    setImmediate(async () => {
      try {
        // Verificar se tabela AuditLog existe no schema
        // Se não existir, apenas logar
        if (prisma.auditLog) {
          await prisma.auditLog.create({
            data: auditEntry
          });
        }
      } catch (error) {
        logger.error('[AuditLog] Failed to save audit entry', {
          error: error.message,
          action
        });
      }
    });
  } catch (error) {
    logger.error('[AuditLog] Error in logAuditEvent', {
      error: error.message
    });
  }
}

/**
 * Middleware para auditif ações em endpoints
 * @param {string} action - Ação a registrar
 * @param {function} getContext - Função para extrair contexto do request
 */
function auditMiddleware(action, getContext) {
  return async (req, res, next) => {
    // Capturar resposta
    const originalJson = res.json;

    res.json = function (data) {
      // Registrar após resposta ser enviada
      if (getContext) {
        try {
          const context = {
            userId: req.user?.id,
            tenantId: req.user?.tenantId,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            correlationId: req.correlationId,
            success: res.statusCode < 400,
            ...getContext(req, res, data)
          };

          logAuditEvent(action, context);
        } catch (error) {
          logger.error('[AuditLog] Error extracting context', { error: error.message });
        }
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Queries para auditoria
 */
const AuditQueries = {
  // Get eventos por usuário
  async getUserEvents(userId, tenantId, limit = 100) {
    if (!prisma.auditLog) {
      return [];
    }
    return prisma.auditLog.findMany({
      where: { userId, tenantId },
      orderBy: { timestamp: 'desc' },
      take: limit
    });
  },

  // Get eventos por recurso
  async getResourceEvents(tenantId, resource, resourceId) {
    if (!prisma.auditLog) {
      return [];
    }
    return prisma.auditLog.findMany({
      where: { tenantId, resource, resourceId },
      orderBy: { timestamp: 'desc' }
    });
  },

  // Get eventos por ação
  async getActionEvents(tenantId, action, limit = 100) {
    if (!prisma.auditLog) {
      return [];
    }
    return prisma.auditLog.findMany({
      where: { tenantId, action },
      orderBy: { timestamp: 'desc' },
      take: limit
    });
  },

  // Relatório de atividade por período
  async getActivityReport(tenantId, startDate, endDate) {
    if (!prisma.auditLog) {
      return {};
    }
    const events = await prisma.auditLog.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    const summary = {};
    for (const event of events) {
      summary[event.action] = (summary[event.action] || 0) + 1;
    }
    return summary;
  }
};

module.exports = {
  AuditAction,
  logAuditEvent,
  auditMiddleware,
  AuditQueries
};
