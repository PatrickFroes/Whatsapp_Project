/**
 * TransferController - Transferências de conversas
 */

const TransferService = const logger = require('../utils/logger');
const '../services/TransferService');
const prisma = require('../services/database');

class TransferController {
  /**
   * POST /api/conversations/:conversationId/transfer
   */
  static async transfer(req, res) {
    try {
      const { conversationId } = req.params;
      const { userId, tenantId } = req.user;
      const { toUserId, reason, notes } = req.body;

      if (!toUserId) {
        return res.status(400).json({ error: 'toUserId is required' });
      }

      // Verificar se conversa pertence ao tenant e está ativa
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId,
          status: { notIn: ['RESOLVED', 'CLOSED'] }
        }
      });

      if (!conversation) {
        return res
          .status(404)
          .json({ error: 'Conversation not found, already closed, or access denied' });
      }

      const result = await TransferService.transfer(
        conversationId,
        toUserId,
        userId,
        reason,
        notes
      );

      res.json(result);
    } catch (error) {
      logger.error('Transfer failed:', error);
      res.status(500).json({
        error: 'Failed to transfer conversation',
        details: error.message
      });
    }
  }

  /**
   * POST /api/conversations/:conversationId/transfer-to-skill
   */
  static async transferToSkill(req, res) {
    try {
      const { conversationId } = req.params;
      const { userId, tenantId } = req.user;
      const { skillId, notes } = req.body;

      if (!skillId) {
        return res.status(400).json({ error: 'skillId is required' });
      }

      // Verificar se conversa pertence ao tenant e está ativa
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId,
          status: { notIn: ['RESOLVED', 'CLOSED'] }
        }
      });

      if (!conversation) {
        return res
          .status(404)
          .json({ error: 'Conversation not found, already closed, or access denied' });
      }

      const result = await TransferService.transferToSkill(conversationId, skillId, userId, notes);

      res.json(result);
    } catch (error) {
      logger.error('Transfer to skill failed:', error);
      res.status(500).json({
        error: 'Failed to transfer to skill',
        details: error.message
      });
    }
  }

  /**
   * GET /api/conversations/:conversationId/transfers
   */
  static async listTransfers(req, res) {
    try {
      const { conversationId } = req.params;
      const { tenantId } = req.user;

      // Verificar se conversa pertence ao tenant
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          tenantId
        }
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found or access denied' });
      }

      const transfers = await TransferService.listTransfers(conversationId);

      res.json(transfers);
    } catch (error) {
      logger.error('List transfers failed:', error);
      res.status(500).json({ error: 'Failed to list transfers' });
    }
  }

  /**
   * GET /api/users/:userId/transfer-stats
   */
  static async getAgentStats(req, res) {
    try {
      const { userId } = req.params;
      const { startDate, endDate } = req.query;

      // Validar que o usuário pertence ao mesmo tenant
      const targetUser = await prisma.user.findFirst({
        where: { id: userId, tenantId: req.user.tenantId },
        select: { id: true }
      });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const start = startDate
        ? new Date(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const stats = await TransferService.getAgentStats(userId, start, end);

      res.json(stats);
    } catch (error) {
      logger.error('Get agent stats failed:', error);
      res.status(500).json({ error: 'Failed to get agent stats' });
    }
  }

  /**
   * GET /api/transfer/available-agents
   * Lista agentes disponíveis para transferência usando AgentStatusService
   */
  static async getAvailableAgents(req, res) {
    try {
      const { tenantId, userId } = req.user;
      const { conversationId } = req.query;

      // Buscar skill da conversa (se houver)
      let skillId = null;
      if (conversationId) {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: {
            flowState: true
          }
        });

        // Tentar extrair skill do flowState
        if (conversation?.flowState?.dept) {
          const skill = await prisma.skill.findFirst({
            where: {
              tenantId,
              name: conversation.flowState.dept
            }
          });
          if (skill) {
            skillId = skill.id;
          }
        }
      }

      // Usar AgentStatusService para buscar agentes disponíveis para transferência
      const AgentStatusService = require('../services/AgentStatusService');
      const agents = await AgentStatusService.getTransferableAgents(tenantId, skillId, userId);

      // Formatar resultado
      const formatted = agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        email: agent.email,
        workStatus: agent.workStatus,
        activeChats: agent._count.assignedConversations,
        maxChats: agent.maxChats,
        available: agent._count.assignedConversations < agent.maxChats
      }));

      // Ordenar por disponibilidade
      formatted.sort((a, b) => {
        if (a.available && !b.available) {
          return -1;
        }
        if (!a.available && b.available) {
          return 1;
        }
        return a.activeChats - b.activeChats;
      });

      res.json(formatted);
    } catch (error) {
      logger.error('Get available agents failed:', error);
      res.status(500).json({ error: 'Failed to get available agents' });
    }
  }

  /**
   * GET /api/transfer/available-skills
   * Lista skills disponíveis para transferência
   */
  static async getAvailableSkills(req, res) {
    try {
      const { tenantId } = req.user;

      const skills = await prisma.skill.findMany({
        where: {
          tenantId
        },
        select: {
          id: true,
          name: true,
          description: true,
          _count: {
            select: {
              users: true
            }
          }
        },
        orderBy: {
          name: 'asc'
        }
      });

      // Formatar resultado incluindo contagem de agentes
      const formatted = skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        agentCount: skill._count.users
      }));

      res.json(formatted);
    } catch (error) {
      logger.error('Get available skills failed:', error);
      res.status(500).json({ error: 'Failed to get available skills' });
    }
  }
}

module.exports = TransferController;
