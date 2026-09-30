const logger = require('../utils/logger');
const prisma =
require('../services/database');

/**
 * Controller para gerenciamento de histórico de conversas
 * Permite visualização de histórico apenas durante interação ativa
 */
class HistoryController {
  /**
   * GET /api/history/contact/:phone
   * Lista todas as sessões (conversas) de um cliente
   * Requer conversa ativa com o cliente
   */
  static async getContactSessions(req, res) {
    try {
      const { phone } = req.params;
      const { tenantId, userId } = req.user;

      // Verificar se existe conversa ativa com este cliente
      const activeConversation = await prisma.conversation.findFirst({
        where: {
          tenantId: tenantId,
          assignedToId: userId,
          contact: {
            phone: phone
          },
          status: {
            in: ['BOT', 'QUEUED', 'ASSIGNED']
          }
        },
        include: {
          contact: true
        }
      });

      if (!activeConversation) {
        return res.status(403).json({
          error: 'Acesso negado',
          message: 'Você só pode visualizar histórico durante uma conversa ativa com este cliente'
        });
      }

      // Buscar contato
      const contact = await prisma.contact.findFirst({
        where: {
          phone: phone,
          tenantId: tenantId
        }
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contato não encontrado' });
      }

      // Buscar todas as conversas (sessões) deste contato
      const sessions = await prisma.conversation.findMany({
        where: {
          contactId: contact.id,
          tenantId: tenantId
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          _count: {
            select: {
              messages: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Formatar resposta
      const sessionsData = sessions.map((session) => ({
        id: session.id,
        status: session.status,
        disposition: session.disposition,
        started_at: session.createdAt,
        ended_at: session.status === 'RESOLVED' ? session.updatedAt : null,
        duration_minutes:
          session.status === 'RESOLVED'
            ? Math.round((new Date(session.updatedAt) - new Date(session.createdAt)) / 60000)
            : null,
        agent: session.assignedTo
          ? {
              id: session.assignedTo.id,
              name: session.assignedTo.name
            }
          : null,
        message_count: session._count.messages,
        is_current: session.id === activeConversation.id
      }));

      res.json({
        contact: {
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          custom_fields: contact.customFields
        },
        total_sessions: sessionsData.length,
        active_session_id: activeConversation.id,
        sessions: sessionsData
      });
    } catch (error) {
      logger.error('[History] Get contact sessions error:', error);
      res.status(500).json({
        error: 'Erro ao buscar sessões',
        details: error.message
      });
    }
  }

  /**
   * GET /api/history/session/:sessionId
   * Busca mensagens de uma sessão específica
   * Requer conversa ativa com o mesmo cliente
   */
  static async getSessionMessages(req, res) {
    try {
      const { sessionId } = req.params;
      const { tenantId, userId } = req.user;
      const { page = 1, limit = 50 } = req.query;

      // Buscar sessão solicitada
      const requestedSession = await prisma.conversation.findFirst({
        where: {
          id: sessionId,
          tenantId: tenantId
        },
        include: {
          contact: true,
          assignedTo: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      if (!requestedSession) {
        return res.status(404).json({ error: 'Sessão não encontrada' });
      }

      // Verificar se agente tem conversa ativa com o mesmo cliente
      const activeConversation = await prisma.conversation.findFirst({
        where: {
          tenantId: tenantId,
          assignedToId: userId,
          contactId: requestedSession.contactId,
          status: {
            in: ['BOT', 'QUEUED', 'ASSIGNED']
          }
        }
      });

      if (req.user.role === 'AGENT' && !activeConversation) {
        return res.status(403).json({
          error: 'Acesso negado',
          message: 'Você só pode visualizar histórico durante uma conversa ativa com este cliente'
        });
      }

      // Buscar mensagens da sessão com paginação
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [messages, totalMessages] = await Promise.all([
        prisma.message.findMany({
          where: {
            conversationId: sessionId
          },
          orderBy: {
            createdAt: 'asc'
          },
          skip: skip,
          take: parseInt(limit)
        }),
        prisma.message.count({
          where: {
            conversationId: sessionId
          }
        })
      ]);

      // Buscar notas internas da sessão
      const internalNotes = await prisma.internalNote.findMany({
        where: {
          conversationId: sessionId,
          conversation: {
            tenantId: tenantId
          }
        },
        include: {
          user: {
            select: {
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      // Extrair token cru do request atual do supervisor para repassar na URL da mídia
      const authHeader = req.headers['authorization'];
      let token = authHeader && authHeader.split(' ')[1];
      if (!token && req.cookies && req.cookies.auth_token) {
        token = require('../utils/crypto').decrypt(req.cookies.auth_token) || req.cookies.auth_token;
      }

      res.json({
        session: {
          id: requestedSession.id,
          contact: {
            phone: requestedSession.contact.phone,
            name: requestedSession.contact.name
          },
          agent: requestedSession.assignedTo?.name,
          status: requestedSession.status,
          disposition: requestedSession.disposition,
          closingNotes: requestedSession.closingNotes,
          surveyResponses: requestedSession.surveyResponses,
          started_at: requestedSession.createdAt,
          ended_at: requestedSession.status === 'RESOLVED' ? requestedSession.updatedAt : null,
          is_current: activeConversation ? requestedSession.id === activeConversation.id : false,
          aiSummary: requestedSession.aiSummary,
          aiSentiment: requestedSession.aiSentiment,
          aiTags: requestedSession.aiTags
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalMessages,
          total_pages: Math.ceil(totalMessages / parseInt(limit))
        },
        messages: messages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          direction: msg.direction,
          message_type: msg.messageType,
          timestamp: msg.createdAt,
          wa_message_id: msg.waMessageId,
          status: msg.status,
          media_url: msg.mediaUrl ? `/api/media/download/${msg.mediaUrl}?token=${token || ''}` : null
        })),
        internal_notes: internalNotes.map((note) => ({
          id: note.id,
          content: note.content,
          created_at: note.createdAt,
          author: note.user.name
        }))
      });
    } catch (error) {
      logger.error('[History] Get session messages error:', error);
      res.status(500).json({
        error: 'Erro ao buscar mensagens',
        details: error.message
      });
    }
  }

  /**
   * GET /api/history/contact/:phone/summary
   * Resumo rápido do histórico do cliente
   */
  static async getContactSummary(req, res) {
    try {
      const { phone } = req.params;
      const { tenantId, userId } = req.user;

      // Verificar conversa ativa
      const activeConversation = await prisma.conversation.findFirst({
        where: {
          tenantId: tenantId,
          assignedToId: userId,
          contact: {
            phone: phone
          },
          status: {
            in: ['BOT', 'QUEUED', 'ASSIGNED']
          }
        }
      });

      if (!activeConversation) {
        return res.status(403).json({
          error: 'Acesso negado',
          message: 'Você só pode visualizar histórico durante uma conversa ativa'
        });
      }

      // Buscar contato
      const contact = await prisma.contact.findFirst({
        where: {
          phone: phone,
          tenantId: tenantId
        }
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contato não encontrado' });
      }

      // Estatísticas
      const [totalSessions, totalMessages, lastSession] = await Promise.all([
        prisma.conversation.count({
          where: {
            contactId: contact.id,
            tenantId: tenantId
          }
        }),
        prisma.message.count({
          where: {
            conversation: {
              contactId: contact.id,
              tenantId: tenantId
            }
          }
        }),
        prisma.conversation.findFirst({
          where: {
            contactId: contact.id,
            tenantId: tenantId,
            id: {
              not: activeConversation.id
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          include: {
            assignedTo: {
              select: {
                name: true
              }
            }
          }
        })
      ]);

      // Contagem por disposição
      const dispositions = await prisma.conversation.groupBy({
        by: ['disposition'],
        where: {
          contactId: contact.id,
          tenantId: tenantId,
          disposition: {
            not: null
          }
        },
        _count: {
          disposition: true
        }
      });

      res.json({
        contact: {
          phone: contact.phone,
          name: contact.name,
          custom_fields: contact.customFields,
          first_contact: contact.createdAt
        },
        summary: {
          total_sessions: totalSessions,
          total_messages: totalMessages,
          dispositions: dispositions.reduce((acc, d) => {
            acc[d.disposition] = d._count.disposition;
            return acc;
          }, {}),
          last_session: lastSession
            ? {
                date: lastSession.createdAt,
                agent: lastSession.assignedTo?.name,
                disposition: lastSession.disposition
              }
            : null
        }
      });
    } catch (error) {
      logger.error('[History] Get contact summary error:', error);
      res.status(500).json({
        error: 'Erro ao buscar resumo',
        details: error.message
      });
    }
  }
}

module.exports = HistoryController;
