const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const AgentStatusService = require('../services/AgentStatusService');

class SupervisorController {
  // Dashboard: Visão Geral da Equipe
  static async getTeamOverview(req, res) {
    try {
      const tenantId = req.tenantId;

      // Lista todos os agentes do tenant (exclui admins/donos se quiser, ou inclui)
      const agents = await prisma.user.findMany({
        where: {
          tenantId,
          role: { in: ['AGENT', 'SUPERVISOR'] }
        },
        select: {
          id: true,
          name: true,
          email: true,
          workStatus: true,
          lastSeenAt: true,
          _count: {
            select: {
              assignedConversations: { where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }
            }
          }
        }
      });

      // Usar AgentStatusService para estatísticas consistentes
      const stats = await AgentStatusService.getStatusStats(tenantId);

      res.json({ stats, agents });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Erro ao carregar visão da equipe' });
    }
  }

  // Ação: Forçar mudança de status de um agente
  static async forceAgentStatus(req, res) {
    try {
      const tenantId = req.tenantId;
      const { agentId } = req.params;
      const { status } = req.body; // ONLINE, OFFLINE, BUSY, AWAY

      // Valida se o agente pertence ao tenant
      const agent = await prisma.user.findUnique({ where: { id: agentId } });

      if (!agent || agent.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Agente não encontrado neste tenant' });
      }

      // Impede alterar status de outro Supervisor ou Admin (Hierarquia)
      if (['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(agent.role)) {
        return res.status(403).json({ error: 'Não é permitido alterar status de um superior' });
      }

      // Usar AgentStatusService para garantir consistência (auto-transfer, validações, etc)
      const result = await AgentStatusService.updateStatus(
        agentId,
        status,
        `Alterado por supervisor (${req.user.username || 'Supervisor'})`,
        tenantId
      );

      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Erro ao alterar status' });
    }
  }

  // Monitoramento: Ver todas as conversas ativas (Mesa de Controle)
  static async getLiveConversations(req, res) {
    try {
      const tenantId = req.tenantId;

      const conversations = await prisma.conversation.findMany({
        where: {
          tenantId,
          status: { notIn: ['RESOLVED', 'CLOSED'] } // Apenas ativas
        },
        include: {
          contact: true,
          assignedTo: { select: { name: true, id: true } },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      // Retorna direto para o frontend ter flexibilidade (compatível com supervisor.js)
      // Ajustamos fields virtuais se necessário
      const formatted = conversations.map((c) => ({
        ...c,
        contact: {
          ...c.contact,
          phone: c.contact.phone // Frontend espera .phone
        }
        // Frontend espera messages[0].content
        // Frontend espera assignedTo.name
      }));

      res.json(formatted);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Erro ao listar conversas' });
    }
  }

  // Histórico: Ver conversas resolvidas ou antigas
  static async getHistory(req, res) {
    try {
      const tenantId = req.tenantId;
      const limit = parseInt(req.query.limit) || 50;

      const conversations = await prisma.conversation.findMany({
        where: {
          tenantId,
          status: 'RESOLVED'
        },
        include: {
          contact: true,
          assignedTo: { select: { name: true, id: true } },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: limit
      });

      const formatted = conversations.map((c) => ({
        ...c,
        contact: {
          ...c.contact,
          phone: c.contact.phone
        }
      }));

      res.json(formatted);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
  }
}

module.exports = SupervisorController;
