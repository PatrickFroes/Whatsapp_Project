/**
 * InternalNoteController - Notas internas em conversas
 */

const InternalNoteService = const logger = require('../utils/logger');
const '../services/InternalNoteService');

class InternalNoteController {
  /**
   * GET /api/conversations/:conversationId/notes
   */
  static async list(req, res) {
    try {
      const { conversationId } = req.params;
      const { tenantId } = req.user;

      const notes = await InternalNoteService.list(conversationId, tenantId);

      res.json(notes);
    } catch (error) {
      logger.error('List notes failed:', error);

      if (error.message === 'Conversation not found or access denied') {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: 'Failed to list notes' });
    }
  }

  /**
   * POST /api/conversations/:conversationId/notes
   */
  static async create(req, res) {
    try {
      const { conversationId } = req.params;
      const { userId, tenantId } = req.user;
      const { content } = req.body;

      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Content is required' });
      }

      const note = await InternalNoteService.create(
        conversationId,
        userId,
        tenantId,
        content.trim()
      );

      res.status(201).json(note);
    } catch (error) {
      logger.error('Create note failed:', error);

      if (error.message === 'Conversation not found or access denied') {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: 'Failed to create note' });
    }
  }

  /**
   * DELETE /api/notes/:noteId
   */
  static async delete(req, res) {
    try {
      const { noteId } = req.params;
      const { userId, role, tenantId } = req.user;

      await InternalNoteService.delete(noteId, userId, role, tenantId);

      res.json({ success: true });
    } catch (error) {
      logger.error('Delete note failed:', error);

      if (error.message === 'Note not found or access denied') {
        return res.status(404).json({ error: error.message });
      }

      if (error.message === 'Unauthorized to delete this note') {
        return res.status(403).json({ error: error.message });
      }

      res.status(500).json({ error: 'Failed to delete note' });
    }
  }

  /**
   * GET /api/conversations/:conversationId/notes/count
   */
  static async count(req, res) {
    try {
      const { conversationId } = req.params;
      const { tenantId } = req.user;

      const count = await InternalNoteService.count(conversationId, tenantId);

      res.json({ count });
    } catch (error) {
      logger.error('Count notes failed:', error);

      if (error.message === 'Conversation not found or access denied') {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: 'Failed to count notes' });
    }
  }
}

module.exports = InternalNoteController;
