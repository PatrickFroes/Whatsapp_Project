/**
 * AgentStatusService - Gerenciamento centralizado de status de agentes
 *
 * Statuses:
 * - ONLINE: Disponível para receber chats
 * - BUSY: Ocupado (sem novos chats automáticos, mas pode receber transfer direto)
 * - AWAY: Ausente temporário (sem novos chats, pode receber transfer direto)
 * - PAUSED: Em pausa (não recebe nada, conversas transferidas automaticamente)
 * - OFFLINE: Fora do sistema (não recebe nada, conversas transferidas automaticamente)
 */

const logger = require('../utils/logger');
const prisma = require('./database');
const TransferService = require('./TransferService');
const QueueService = require('./QueueService');
const { getIO } = require('./socket');

// Status válidos
const VALID_STATUSES = ['ONLINE', 'BUSY', 'AWAY', 'PAUSED', 'OFFLINE'];

// Status que bloqueiam novos chats automáticos
const UNAVAILABLE_STATUSES = ['PAUSED', 'OFFLINE'];

// Status que bloqueiam transfers diretos
const TRANSFER_BLOCKED_STATUSES = ['OFFLINE'];

class AgentStatusService {
  /**
   * Atualiza status do agente com validações e side-effects
   */
  static async updateStatus(userId, status, reason = null, tenantId = null) {
    // Normalizar status para UPPERCASE
    const normalizedStatus = status.toUpperCase();

    // Validar status
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      throw new Error(`Status inválido: ${status}. Válidos: ${VALID_STATUSES.join(', ')}`);
    }

    // Buscar agente
    const agent = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        workStatus: true,
        tenantId: true,
        name: true,
        email: true,
        _count: {
          select: {
            assignedConversations: {
              where: { status: { in: ['ASSIGNED', 'QUEUED'] } }
            }
          }
        }
      }
    });

    if (!agent) {
      throw new Error('Agente não encontrado');
    }

    // Se o agente quer ir para OFFLINE ou PAUSED mas possui chats ativos (ASSIGNED ou QUEUED)
    if (normalizedStatus === 'OFFLINE' || normalizedStatus === 'PAUSED') {
      const activeChatsCount = agent._count.assignedConversations || 0;

      if (activeChatsCount > 0) {
        logger.info(`[AgentStatus] ${agent.name} possui ${activeChatsCount} chats ativos. Agendando status pendente: ${normalizedStatus}`);
        const pendingValue = normalizedStatus === 'PAUSED' ? `PENDING_PAUSE:${reason || ''}` : 'PENDING_OFFLINE';
        
        await prisma.user.update({
          where: { id: userId },
          data: {
            workStatus: 'BUSY',
            statusReason: pendingValue,
            lastSeenAt: new Date()
          }
        });

        const effectiveTenantId = tenantId || agent.tenantId;
        this.notifyStatusChange(effectiveTenantId, userId, 'BUSY', pendingValue, agent);

        return {
          success: true,
          status: 'BUSY',
          pendingStatus: normalizedStatus,
          message: `Você tem ${activeChatsCount} conversas ativas. A mudança para ${normalizedStatus} será aplicada automaticamente ao finalizar todos os atendimentos.`
        };
      }
    }

    const previousStatus = agent.workStatus;
    const effectiveTenantId = tenantId || agent.tenantId;

    logger.debug(
      `[AgentStatus] ${agent.name} (${agent.email}): ${previousStatus} → ${normalizedStatus}`
    );

    // Se já está no mesmo status, apenas atualiza reason
    if (previousStatus === normalizedStatus) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          statusReason: reason,
          lastSeenAt: new Date()
        }
      });

      // Notificar via Socket.io
      this.notifyStatusChange(effectiveTenantId, userId, normalizedStatus, reason, agent);

      return {
        success: true,
        status: normalizedStatus,
        reason,
        message: 'Status atualizado (sem mudança de estado)'
      };
    }

    // Atualizar status no banco
    await prisma.user.update({
      where: { id: userId },
      data: {
        workStatus: normalizedStatus,
        statusReason: reason,
        lastSeenAt: new Date()
      }
    });

    // Side-effects baseados no novo status
    await this.handleStatusSideEffects(
      userId,
      normalizedStatus,
      previousStatus,
      effectiveTenantId,
      agent,
      reason
    );

    // Notificar via Socket.io
    this.notifyStatusChange(effectiveTenantId, userId, normalizedStatus, reason, agent);

    return {
      success: true,
      status: normalizedStatus,
      previousStatus,
      reason,
      message: `Status alterado de ${previousStatus} para ${normalizedStatus}`
    };
  }

  /**
   * Trata side-effects de mudança de status
   */
  static async handleStatusSideEffects(userId, newStatus, previousStatus, tenantId, agent, reason) {
    logger.debug(`[AgentStatus] Processando side-effects: ${previousStatus} → ${newStatus}`);

    // 1. OFFLINE ou PAUSED: Auto-transfer de conversas ativas
    if (newStatus === 'OFFLINE' || newStatus === 'PAUSED') {
      const activeChats = agent._count.assignedConversations || 0;

      if (activeChats > 0) {
        logger.debug(
          `[AgentStatus] ${agent.name} tem ${activeChats} conversas ativas. Iniciando auto-transfer...`
        );

        try {
          const result = await TransferService.autoTransferOnOffline(userId, tenantId);
          logger.debug('[AgentStatus] Auto-transfer completo:', result);

          // Notificar agente sobre transfers
          this.notifyAutoTransfer(tenantId, userId, result, newStatus, reason);
        } catch (error) {
          logger.error('[AgentStatus] Erro no auto-transfer:', error);
        }
      } else {
        logger.debug(
          `[AgentStatus] ${agent.name} não tem conversas ativas. Nenhum transfer necessário.`
        );
      }
    }

    // 2. ONLINE: Processar fila
    if (newStatus === 'ONLINE') {
      logger.debug(`[AgentStatus] ${agent.name} voltou ONLINE. Processando fila...`);

      // Fire and forget
      QueueService.processQueue(tenantId).catch((err) =>
        logger.error('[AgentStatus] Erro ao processar fila:', err)
      );
    }

    // 3. AWAY ou BUSY: Apenas log
    if (newStatus === 'AWAY' || newStatus === 'BUSY') {
      logger.debug(
        `[AgentStatus] ${agent.name} mudou para ${newStatus}. Mantendo conversas atuais.`
      );
    }
  }

  /**
   * Notifica mudança de status via Socket.io
   */
  static notifyStatusChange(tenantId, userId, status, reason, agent) {
    const io = getIO();
    if (!io) {
      return;
    }

    const payload = {
      userId,
      userName: agent.name,
      userEmail: agent.email,
      status,
      reason,
      timestamp: new Date().toISOString()
    };

    // Emitir para room do tenant (todos supervisores/admins veem)
    io.to(`tenant:${tenantId}`).emit('agent_status_changed', payload);

    // Emitir para o próprio agente (se conectado)
    io.to(`user:${userId}`).emit('status_updated', {
      userId,
      status,
      reason,
      timestamp: payload.timestamp
    });

    logger.debug(`[AgentStatus] Socket.io notificado: ${agent.name} → ${status}`);
  }

  /**
   * Notifica auto-transfer de conversas
   */
  static notifyAutoTransfer(tenantId, userId, result, newStatus, reason) {
    const io = getIO();
    if (!io) {
      return;
    }

    const message =
      result.transferred > 0
        ? `${result.transferred} conversa(s) transferida(s) automaticamente`
        : result.queued > 0
          ? `${result.queued} conversa(s) retornada(s) para fila`
          : 'Nenhuma conversa para transferir';

    io.to(`user:${userId}`).emit('auto_transfer_notification', {
      status: newStatus,
      reason,
      transferred: result.transferred || 0,
      queued: result.queued || 0,
      message,
      timestamp: new Date().toISOString()
    });

    logger.debug(`[AgentStatus] Auto-transfer notificado: ${message}`);
  }

  /**
   * Verifica se agente pode receber novos chats automáticos (da fila)
   */
  static canReceiveNewChats(workStatus) {
    return workStatus === 'ONLINE';
  }

  /**
   * Verifica se agente pode receber transfer direto
   */
  static canReceiveDirectTransfer(workStatus) {
    return !TRANSFER_BLOCKED_STATUSES.includes(workStatus);
  }

  /**
   * Busca agentes disponíveis para novos chats (fila)
   */
  static async getAvailableAgents(tenantId, skillId = null) {
    const where = {
      tenantId,
      workStatus: 'ONLINE', // Apenas ONLINE recebe da fila
      role: { in: ['AGENT', 'SUPERVISOR', 'ADMIN'] }
    };

    if (skillId) {
      where.skills = {
        some: { skillId }
      };
    }

    const agents = await prisma.user.findMany({
      where,
      include: {
        assignedConversations: {
          where: { status: { in: ['ASSIGNED', 'QUEUED'] } },
          select: { initiationType: true }
        }
      }
    });

    // Filtrar por limite de chats recebidos (inbound)
    const available = agents.filter((a) => {
      const receivedCount = a.assignedConversations.filter((c) => c.initiationType === 'INBOUND').length;
      return receivedCount < (a.maxReceivedChats ?? 5);
    });

    // Ordenar por total de conversas ativas (menos ocupado primeiro)
    available.sort((a, b) => a.assignedConversations.length - b.assignedConversations.length);

    return available;
  }

  /**
   * Busca agentes disponíveis para transfer direto
   */
  static async getTransferableAgents(tenantId, skillId = null, excludeUserId = null) {
    const where = {
      tenantId,
      workStatus: { notIn: TRANSFER_BLOCKED_STATUSES }, // OFFLINE bloqueado
      role: { in: ['AGENT', 'SUPERVISOR', 'ADMIN'] }
    };

    if (skillId) {
      where.skills = {
        some: { skillId }
      };
    }

    if (excludeUserId) {
      where.id = { not: excludeUserId };
    }

    const agents = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        workStatus: true,
        statusReason: true,
        maxChats: true,
        maxActiveChats: true,
        maxReceivedChats: true,
        skills: {
          include: {
            skill: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        assignedConversations: {
          where: { status: { in: ['ASSIGNED', 'QUEUED'] } },
          select: { id: true, initiationType: true }
        }
      }
    });

    // Ordenar por total de conversas ativas (menos ocupado primeiro)
    agents.sort((a, b) => a.assignedConversations.length - b.assignedConversations.length);

    return agents;
  }

  /**
   * Retorna estatísticas de status dos agentes
   */
  static async getStatusStats(tenantId) {
    const agents = await prisma.user.findMany({
      where: {
        tenantId,
        role: 'AGENT'
      },
      select: {
        workStatus: true
      }
    });

    const stats = {
      total: agents.length,
      online: 0,
      busy: 0,
      away: 0,
      paused: 0,
      offline: 0
    };

    agents.forEach((a) => {
      const status = a.workStatus.toLowerCase();
      if (stats[status] !== undefined) {
        stats[status]++;
      }
    });

    return stats;
  }

  /**
   * Configura motivos de pausa do tenant
   */
  static async configurePauseReasons(tenantId, reasons) {
    if (!Array.isArray(reasons)) {
      throw new Error('Reasons deve ser um array');
    }

    // Validar estrutura
    reasons.forEach((r) => {
      if (!r.label || typeof r.label !== 'string') {
        throw new Error('Cada reason deve ter um label (string)');
      }
    });

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        pauseReasons: reasons
      }
    });

    return { success: true, reasons };
  }

  /**
   * Busca motivos de pausa do tenant
   */
  static async getPauseReasons(tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { pauseReasons: true }
    });

    const defaultReasons = [
      { label: 'Almoço', maxMinutes: 60 },
      { label: 'Pausa Curta', maxMinutes: 15 },
      { label: 'Reunião', maxMinutes: 30 },
      { label: 'Treinamento', maxMinutes: 60 },
      { label: 'Outros', maxMinutes: null }
    ];

    // Se não tem pauseReasons configurado, retorna defaults
    if (!tenant?.pauseReasons) {
      return defaultReasons;
    }

    // Se pauseReasons é um array, retorna direto
    if (Array.isArray(tenant.pauseReasons)) {
      return tenant.pauseReasons;
    }

    // Se pauseReasons é um objeto com propriedade reasons (array), retorna reasons
    if (tenant.pauseReasons.reasons && Array.isArray(tenant.pauseReasons.reasons)) {
      return tenant.pauseReasons.reasons;
    }

    // Fallback para defaults se estrutura for inesperada
    logger.warn('[AgentStatusService] pauseReasons em formato inesperado:', tenant.pauseReasons);
    return defaultReasons;
  }

  /**
   * Configura motivos de encerramento (dispositions) do tenant
   */
  static async configureCloseDispositions(tenantId, dispositions) {
    if (!Array.isArray(dispositions)) {
      throw new Error('Dispositions deve ser um array');
    }

    // Validar estrutura
    dispositions.forEach((d) => {
      if (!d.label || typeof d.label !== 'string') {
        throw new Error('Cada disposition deve ter um label (string)');
      }
    });

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        closeDispositions: dispositions
      }
    });

    return { success: true, dispositions };
  }

  /**
   * Busca motivos de encerramento (dispositions) do tenant
   */
  static async getCloseDispositions(tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { closeDispositions: true }
    });

    const defaultDispositions = [
      { label: 'Dúvida Sanada' },
      { label: 'Venda Realizada' },
      { label: 'Problema Técnico' },
      { label: 'Não Respondeu' },
      { label: 'Indesejado' },
      { label: 'Outros' }
    ];

    // Se não tem closeDispositions configurado, retorna defaults
    if (!tenant?.closeDispositions) {
      return defaultDispositions;
    }

    // Se closeDispositions é um array, retorna direto
    if (Array.isArray(tenant.closeDispositions)) {
      return tenant.closeDispositions;
    }

    // Se closeDispositions é um objeto com propriedade dispositions (array), retorna dispositions
    if (tenant.closeDispositions.dispositions && Array.isArray(tenant.closeDispositions.dispositions)) {
      return tenant.closeDispositions.dispositions;
    }

    // Fallback para defaults se estrutura for inesperada
    logger.warn('[AgentStatusService] closeDispositions em formato inesperado:', tenant.closeDispositions);
    return defaultDispositions;
  }

  /**
   * Verifica se o agente possui mudança de status pendente e a aplica se ele não tiver mais conversas ativas.
   */
  static async checkAndApplyPendingStatus(userId, tenantId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          workStatus: true,
          statusReason: true,
          name: true,
          email: true,
          tenantId: true
        }
      });

      if (!user) return;

      const reason = user.statusReason || '';
      const isPendingPause = reason.startsWith('PENDING_PAUSE:');
      const isPendingOffline = reason === 'PENDING_OFFLINE';

      if (!isPendingPause && !isPendingOffline) {
        return; // Sem status pendente
      }

      // Contar conversas ativas
      const activeChatsCount = await prisma.conversation.count({
        where: {
          assignedToId: userId,
          status: { in: ['ASSIGNED', 'QUEUED'] }
        }
      });

      if (activeChatsCount === 0) {
        const targetStatus = isPendingPause ? 'PAUSED' : 'OFFLINE';
        const finalReason = isPendingPause ? reason.replace('PENDING_PAUSE:', '') : 'Todas as conversas finalizadas';

        logger.info(`[AgentStatus] ${user.name} finalizou todas as conversas. Aplicando status pendente: ${targetStatus}.`);

        // Atualiza o status no banco
        await prisma.user.update({
          where: { id: userId },
          data: {
            workStatus: targetStatus,
            statusReason: finalReason,
            lastSeenAt: new Date()
          }
        });

        // Notificar mudança
        const effectiveTenantId = tenantId || user.tenantId;
        this.notifyStatusChange(effectiveTenantId, userId, targetStatus, finalReason, user);
      }
    } catch (err) {
      logger.error('[AgentStatus] Erro ao verificar status pendente do agente:', err);
    }
  }
}

module.exports = AgentStatusService;
