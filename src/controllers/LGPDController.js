const prisma = const logger = require('../utils/logger');
const '../services/database');

/**
 * Controller para endpoints de conformidade com LGPD
 * Lei Geral de Proteção de Dados (Lei 13.709/2018)
 */
class LGPDController {
  /**
   * GET /api/lgpd/export
   * Exporta todos os dados do usuário (Direito à portabilidade)
   */
  static async exportUserData(req, res) {
    try {
      const { userId, tenantId } = req.user;

      logger.debug(`[LGPD] Export data request - User: ${userId}`);

      // Buscar dados do usuário
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          workStatus: true,
          maxChats: true,
          createdAt: true,
          updatedAt: true,
          lastSeenAt: true
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      // Buscar conversas atribuídas
      const conversations = await prisma.conversation.findMany({
        where: {
          assignedToId: userId,
          tenantId: tenantId
        },
        include: {
          contact: {
            select: {
              phone: true,
              name: true
            }
          }
        }
      });

      // Buscar mensagens (últimos 90 dias para não sobrecarregar)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const messages = await prisma.message.findMany({
        where: {
          conversation: {
            assignedToId: userId,
            tenantId: tenantId
          },
          createdAt: {
            gte: ninetyDaysAgo
          }
        },
        select: {
          id: true,
          content: true,
          direction: true,
          createdAt: true,
          conversationId: true
        },
        take: 10000 // Limite de segurança
      });

      // Buscar notas internas criadas pelo usuário
      const internalNotes = await prisma.internalNote.findMany({
        where: {
          userId: userId,
          conversation: {
            tenantId: tenantId
          }
        },
        select: {
          id: true,
          content: true,
          createdAt: true,
          conversationId: true
        }
      });

      // Buscar transferências
      const transfersFrom = await prisma.conversationTransfer.findMany({
        where: {
          fromUserId: userId,
          conversation: {
            tenantId: tenantId
          }
        },
        select: {
          id: true,
          reason: true,
          transferredAt: true,
          conversationId: true
        }
      });

      const transfersTo = await prisma.conversationTransfer.findMany({
        where: {
          toUserId: userId,
          conversation: {
            tenantId: tenantId
          }
        },
        select: {
          id: true,
          reason: true,
          transferredAt: true,
          conversationId: true
        }
      });

      // Montar objeto de exportação
      const exportData = {
        export_date: new Date().toISOString(),
        data_protection_law: 'LGPD - Lei 13.709/2018',
        user: user,
        statistics: {
          total_conversations: conversations.length,
          total_messages: messages.length,
          total_notes: internalNotes.length,
          total_transfers_sent: transfersFrom.length,
          total_transfers_received: transfersTo.length
        },
        conversations: conversations.map((conv) => ({
          id: conv.id,
          contact_phone: conv.contact.phone,
          contact_name: conv.contact.name,
          status: conv.status,
          created_at: conv.createdAt,
          updated_at: conv.updatedAt
        })),
        messages: messages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          direction: msg.direction,
          timestamp: msg.createdAt,
          conversation_id: msg.conversationId
        })),
        internal_notes: internalNotes.map((note) => ({
          id: note.id,
          content: note.content,
          created_at: note.createdAt,
          conversation_id: note.conversationId
        })),
        transfers: {
          sent: transfersFrom.map((t) => ({
            id: t.id,
            reason: t.reason,
            transferred_at: t.transferredAt,
            conversation_id: t.conversationId
          })),
          received: transfersTo.map((t) => ({
            id: t.id,
            reason: t.reason,
            transferred_at: t.transferredAt,
            conversation_id: t.conversationId
          }))
        },
        rights_information: {
          message: 'Você tem direito a correção, exclusão e outros conforme LGPD',
          contact: 'dpo@whatsappbroker.com'
        }
      };

      logger.debug(`[LGPD] Data exported successfully - User: ${userId}`);

      res.json(exportData);
    } catch (error) {
      logger.error('[LGPD] Export error:', error);
      res.status(500).json({
        error: 'Erro ao exportar dados',
        details: error.message
      });
    }
  }

  /**
   * DELETE /api/lgpd/delete
   * Deleta permanentemente a conta do usuário (Direito ao esquecimento)
   */
  static async deleteUserAccount(req, res) {
    try {
      const { userId, tenantId, role } = req.user;

      logger.debug(`[LGPD] Delete account request - User: ${userId}`);

      // Verificar se usuário existe
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      // Prevenir exclusão do último admin do tenant
      if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
        const adminCount = await prisma.user.count({
          where: {
            tenantId: tenantId,
            role: { in: ['ADMIN', 'SUPER_ADMIN'] }
          }
        });

        if (adminCount <= 1) {
          return res.status(400).json({
            error: 'Não é possível deletar o último administrador do tenant',
            message: 'Transfira a propriedade ou adicione outro admin primeiro'
          });
        }
      }

      // Desatribuir conversas antes de deletar
      await prisma.conversation.updateMany({
        where: {
          assignedToId: userId,
          tenantId: tenantId
        },
        data: {
          assignedToId: null,
          status: 'QUEUED'
        }
      });

      // Anonimizar notas internas (manter histórico mas remover autoria)
      await prisma.internalNote.updateMany({
        where: {
          userId: userId,
          conversation: {
            tenantId: tenantId
          }
        },
        data: {
          content: '[Nota do usuário deletado - conteúdo removido por solicitação LGPD]'
        }
      });

      // Deletar usuário (cascade vai deletar relacionamentos)
      await prisma.user.delete({
        where: { id: userId }
      });

      logger.debug(`[LGPD] Account deleted successfully - User: ${userId}`);

      res.json({
        success: true,
        message: 'Conta deletada com sucesso',
        deleted_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[LGPD] Delete error:', error);
      res.status(500).json({
        error: 'Erro ao deletar conta',
        details: error.message
      });
    }
  }

  /**
   * GET /api/lgpd/consent
   * Lista consentimentos do usuário
   */
  static async getConsents(req, res) {
    try {
      const { userId } = req.user;

      // Buscar consentimentos (se você tiver uma tabela de consentimentos)
      // Por enquanto, retornar consentimentos padrão
      const consents = {
        user_id: userId,
        consents: [
          {
            type: 'terms_of_service',
            description: 'Termos de Uso',
            granted: true,
            required: true,
            granted_at: null // TODO: adicionar data quando implementar tabela
          },
          {
            type: 'privacy_policy',
            description: 'Política de Privacidade',
            granted: true,
            required: true,
            granted_at: null
          },
          {
            type: 'marketing_communications',
            description: 'Receber comunicações de marketing',
            granted: false,
            required: false,
            granted_at: null
          }
        ]
      };

      res.json(consents);
    } catch (error) {
      logger.error('[LGPD] Get consents error:', error);
      res.status(500).json({
        error: 'Erro ao buscar consentimentos',
        details: error.message
      });
    }
  }

  /**
   * POST /api/lgpd/consent
   * Atualiza consentimentos do usuário
   */
  static async updateConsents(req, res) {
    try {
      const { userId } = req.user;
      const { consents } = req.body;

      if (!consents || !Array.isArray(consents)) {
        return res.status(400).json({ error: 'Formato inválido de consentimentos' });
      }

      // TODO: Implementar tabela de consentimentos no Prisma
      // Por enquanto, apenas log
      logger.debug(`[LGPD] Consent update - User: ${userId}`, consents);

      res.json({
        success: true,
        message: 'Consentimentos atualizados',
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[LGPD] Update consents error:', error);
      res.status(500).json({
        error: 'Erro ao atualizar consentimentos',
        details: error.message
      });
    }
  }
}

module.exports = LGPDController;
