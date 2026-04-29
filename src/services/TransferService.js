/**
 * TransferService - Transferência de conversas entre agentes
 */

const prisma = const logger = require('../utils/logger');
const './database');
const { getIO } = require('./socket');

class TransferService {
  /**
   * Transfere conversa para outro agente
   */
  static async transfer(conversationId, toUserId, fromUserId = null, reason = null, notes = null) {
    // Buscar conversa
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: true,
        assignedTo: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Buscar usuário destino - sempre filtrando pelo mesmo tenant da conversa (SECURITY)
    const toUser = await prisma.user.findFirst({
      where: {
        id: toUserId,
        tenantId: conversation.tenantId, // SECURITY: Prevents cross-tenant transfers
        role: { in: ['AGENT', 'SUPERVISOR', 'ADMIN'] }
      }
    });

    if (!toUser) {
      throw new Error('Target user not found or invalid');
    }

    // Verificar se agente está disponível para receber transfer
    const AgentStatusService = require('./AgentStatusService');
    if (!AgentStatusService.canReceiveDirectTransfer(toUser.workStatus)) {
      throw new Error(`Target agent is ${toUser.workStatus} and cannot receive transfers`);
    }

    // Verificar limite de conversas do agente
    const assignedCount = await prisma.conversation.count({
      where: {
        assignedToId: toUserId,
        status: { in: ['ASSIGNED'] }
      }
    });

    if (assignedCount >= toUser.maxChats) {
      throw new Error(`Target agent has reached maximum concurrent chats (${toUser.maxChats})`);
    }

    // Registrar transferência
    const transfer = await prisma.conversationTransfer.create({
      data: {
        conversationId,
        fromUserId,
        toUserId,
        reason,
        notes
      },
      include: {
        fromUser: {
          select: { id: true, name: true, email: true }
        },
        toUser: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    // Atualizar conversa
    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        assignedToId: toUserId,
        status: 'ASSIGNED'
      },
      include: {
        contact: true,
        assignedTo: {
          select: { id: true, name: true, email: true, workStatus: true }
        }
      }
    });

    // Emitir via Socket.io - Usar tenant room para alcançar todos os agentes
    const io = getIO();

    // Notificar todo o tenant sobre a transferência
    io.to(`tenant:${conversation.tenantId}`).emit('conversation-transferred', {
      conversationId,
      conversation: updated,
      from: transfer.fromUser,
      to: transfer.toUser,
      fromUserId,
      toUserId,
      reason,
      notes
    });

    return {
      transfer,
      conversation: updated
    };
  }

  /**
   * Lista histórico de transferências de uma conversa
   */
  static async listTransfers(conversationId) {
    return await prisma.conversationTransfer.findMany({
      where: { conversationId },
      include: {
        fromUser: {
          select: { id: true, name: true, email: true }
        },
        toUser: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  /**
   * Estatísticas de transferências de um agente
   */
  static async getAgentStats(userId, startDate, endDate) {
    const transfersOut = await prisma.conversationTransfer.count({
      where: {
        fromUserId: userId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    const transfersIn = await prisma.conversationTransfer.count({
      where: {
        toUserId: userId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    // Razões mais comuns
    const topReasons = await prisma.conversationTransfer.groupBy({
      by: ['reason'],
      where: {
        fromUserId: userId,
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        reason: { not: null }
      },
      _count: true,
      orderBy: {
        _count: {
          reason: 'desc'
        }
      },
      take: 5
    });

    return {
      transfersOut,
      transfersIn,
      topReasons: topReasons.map((r) => ({
        reason: r.reason,
        count: r._count
      }))
    };
  }

  /**
   * Auto-transferência quando agente fica offline
   */
  static async autoTransferOnOffline(userId, tenantId) {
    // Buscar conversas atribuídas ao agente - FILTRADO POR TENANT
    const conversations = await prisma.conversation.findMany({
      where: {
        assignedToId: userId,
        tenantId: tenantId, // SECURITY: Explicit tenant isolation
        status: 'ASSIGNED'
      }
    });

    if (conversations.length === 0) {
      return { transferred: 0 };
    }

    // Buscar agente disponível do mesmo tenant usando AgentStatusService
    const AgentStatusService = require('./AgentStatusService');
    const availableAgents = await AgentStatusService.getTransferableAgents(tenantId, null, userId);

    // Pegar o menos ocupado que ainda tem capacidade
    const availableAgent = availableAgents.find((a) => a._count.assignedConversations < a.maxChats);

    if (!availableAgent) {
      // Nenhum agente disponível, retornar para fila
      await prisma.conversation.updateMany({
        where: {
          assignedToId: userId,
          status: 'ASSIGNED'
        },
        data: {
          assignedToId: null,
          status: 'QUEUED'
        }
      });

      return { transferred: 0, queued: conversations.length };
    }

    // Transferir todas as conversas
    let transferred = 0;
    for (const conv of conversations) {
      try {
        await this.transfer(
          conv.id,
          availableAgent.id,
          userId,
          'Agent went offline',
          'Auto-transferred by system'
        );
        transferred++;
      } catch (error) {
        logger.error(`Failed to auto-transfer conversation ${conv.id}:`, error);
      }
    }

    return { transferred };
  }

  /**
   * Transfere para skill específica (retorna para fila filtrada)
   */
  static async transferToSkill(conversationId, skillId, fromUserId = null, notes = null) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Verificar se skill existe
    const skill = await prisma.skill.findFirst({
      where: {
        id: skillId,
        tenantId: conversation.tenantId
      }
    });

    if (!skill) {
      throw new Error('Skill not found');
    }

    // Retornar para fila com metadata de skill
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        assignedToId: null,
        status: 'QUEUED',
        flowState: {
          requiredSkill: skillId
        }
      }
    });

    // Registrar transferência
    await prisma.conversationTransfer.create({
      data: {
        conversationId,
        fromUserId,
        toUserId: null, // Será atribuído depois
        reason: `Transferred to skill: ${skill.name}`,
        notes
      }
    });

    // Notificar via Socket.io - Usar tenant room
    const io = getIO();
    io.to(`tenant:${conversation.tenantId}`).emit('conversation-queued-skill', {
      conversationId,
      skill
    });

    return { success: true, skill };
  }
}

module.exports = TransferService;
