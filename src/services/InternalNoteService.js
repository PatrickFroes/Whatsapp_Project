/**
 * InternalNoteService - Notas internas (visíveis apenas para agentes)
 */

const prisma = require('./database');
const { getIO } = require('./socket');

class InternalNoteService {
  /**
   * Cria nova nota interna
   */
  static async create(conversationId, userId, tenantId, content) {
    // Verificar se conversa pertence ao tenant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        tenantId
      }
    });

    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    const note = await prisma.internalNote.create({
      data: {
        conversationId,
        userId,
        content
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    // Emitir via Socket.io para outros agentes da conversa
    const io = getIO();
    // Usar o conversation já buscado acima
    if (conversation) {
      io.to(`conversation:${conversation.id}`).emit('internal-note', note);
    }

    return note;
  }

  /**
   * Lista notas de uma conversa
   */
  static async list(conversationId, tenantId) {
    // Verificar se conversa pertence ao tenant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        tenantId
      }
    });

    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    return await prisma.internalNote.findMany({
      where: { conversationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
  }

  /**
   * Deleta nota (apenas autor ou admin)
   */
  static async delete(noteId, userId, userRole, tenantId) {
    const note = await prisma.internalNote.findUnique({
      where: { id: noteId },
      include: {
        conversation: {
          select: { tenantId: true }
        }
      }
    });

    if (!note) {
      throw new Error('Note not found or access denied');
    }

    // Verificar se nota pertence ao tenant
    if (note.conversation.tenantId !== tenantId) {
      throw new Error('Note not found or access denied');
    }

    // Apenas autor ou ADMIN/SUPERVISOR podem deletar
    if (note.userId !== userId && !['ADMIN', 'SUPERVISOR'].includes(userRole)) {
      throw new Error('Unauthorized to delete this note');
    }

    await prisma.internalNote.delete({
      where: { id: noteId }
    });

    // Emitir via Socket.io
    const io = getIO();
    const conversation = await prisma.conversation.findUnique({
      where: { id: note.conversationId },
      select: { id: true }
    });
    if (conversation) {
      io.to(`conversation:${conversation.id}`).emit('internal-note-deleted', {
        noteId,
        conversationId: note.conversationId
      });
    }

    return { success: true };
  }

  /**
   * Conta notas de uma conversa
   */
  static async count(conversationId, tenantId) {
    // Verificar se conversa pertence ao tenant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        tenantId
      }
    });

    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    return await prisma.internalNote.count({
      where: { conversationId }
    });
  }
}

module.exports = InternalNoteService;
