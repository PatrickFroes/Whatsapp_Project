const logger = require('../utils/logger');
const prisma =
const './database');
const socketService = require('./socket');

class QueueService {
  // Called when an agent comes ONLINE or finishes a chat
  static async processQueue(tenantId) {
    logger.debug(`[QueueService] Processing queue for tenant ${tenantId}...`);

    // 1. Get all QUEUED items for this tenant, ordered by waiting time (oldest first)
    const queuedItems = await prisma.conversation.findMany({
      where: {
        tenantId: tenantId,
        status: 'QUEUED'
      },
      orderBy: { lastMessageAt: 'asc' } // Oldest first
    });

    if (queuedItems.length === 0) {
      logger.debug('[QueueService] No items in queue.');
      return;
    }

    logger.debug(`[QueueService] Found ${queuedItems.length} items in queue.`);

    // 2. Iterate and try to assign
    for (const conversation of queuedItems) {
      // LAW: Skip conversations that are waiting for business hours to open.
      // These clients sent a message outside business hours and received an offline reply.
      // They must NOT be auto-assigned to an agent — the only correct trigger is the
      // client sending a NEW message, which WebhookController handles by resetting the
      // conversation back to BOT status and running FlowEngine.
      if (conversation.flowState?.waitingForBusiness === true) {
        logger.debug(
          `[QueueService] Skipping waitingForBusiness conversation ${conversation.id} — awaiting new client message`
        );
        continue;
      }

      // flowState: { nodeId: '...', dept: 'Sales', ... }

      let targetSkill = null;
      if (conversation.flowState && conversation.flowState.dept) {
        const deptValue = conversation.flowState.dept?.trim();
        if (deptValue && deptValue.length > 0) {
          targetSkill = deptValue;
        } else {
          logger.warn(
            `[QueueService] Invalid/empty dept in flowState for conversation ${conversation.id}`
          );
        }
      }

      // Find valid agent
      const agent = await QueueService.findAvailableAgent(tenantId, targetSkill);

      if (agent) {
        await QueueService.assign(conversation, agent);
      } else {
        // If we can't assign the oldest, we probably can't assign usage checking for same skill.
        // Stop to avoid thrashing, unless different skills involved.
      }
    }
  }

  static async findAvailableAgent(tenantId, skillName) {
    // Resolver skill ID se especificado
    let skillId = null;
    if (skillName) {
      const skill = await prisma.skill.findFirst({
        where: { tenantId_name: { tenantId, name: skillName } }
      });

      if (skill) {
        skillId = skill.id;
      }
    }

    // Usar AgentStatusService para buscar agentes disponíveis
    const AgentStatusService = require('./AgentStatusService');
    const agents = await AgentStatusService.getAvailableAgents(tenantId, skillId);

    if (agents.length === 0) {
      return null;
    }

    // AgentStatusService já retorna ordenado por menos ocupado e com capacidade
    return agents[0];
  }

  static async assign(conversation, agent) {
    logger.debug(`[QueueService] Assigning ${conversation.id} to ${agent.name}`);

    // SECURITY: Validate that agent belongs to same tenant as conversation
    if (agent.tenantId !== conversation.tenantId) {
      throw new Error(
        `🔍 [QueueService] SECURITY VIOLATION: Attempted cross-tenant assignment. Conversation tenant: ${conversation.tenantId}, Agent tenant: ${agent.tenantId}`
      );
    }

    // Update DB with explicit tenant validation
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'ASSIGNED',
        assignedToId: agent.id
      }
    });

    // SECURITY: Verify the conversation after update
    if (updated.tenantId !== conversation.tenantId) {
      logger.error(
        `🔍 [QueueService] SECURITY: Conversation tenant mismatch after update`
      );
    }

    // Notify
    try {
      // Use singleton
      const io = socketService.getIO();
      if (io) {
        io.to(`tenant:${conversation.tenantId}`).emit('chat_assigned', {
          conversationId: conversation.id,
          agentId: agent.id,
          agentName: agent.name,
          phone: conversation.contactId // Might need phone detail from include
        });
      }
    } catch (e) {
      logger.error('[QueueService] Socket emit error:', e.message);
    }
  }
}

module.exports = QueueService;
