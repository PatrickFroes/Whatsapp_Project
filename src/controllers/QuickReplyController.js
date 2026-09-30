/**
 * QuickReplyController - CRUD de respostas rápidas
 */

const logger = require('../utils/logger');
const QuickReplyService = require('../services/QuickReplyService');

class QuickReplyController {
  /**
   * GET /api/quick-replies
   */
  static async list(req, res) {
    try {
      const { tenantId } = req.user;
      const { category, isActive, search } = req.query;

      const filters = {};
      if (category) {
        filters.category = category;
      }
      if (isActive !== undefined) {
        filters.isActive = isActive === 'true';
      }
      if (search) {
        filters.search = search;
      }

      const replies = await QuickReplyService.list(tenantId, filters);

      res.json(replies);
    } catch (error) {
      logger.error('List quick replies failed:', error);
      res.status(500).json({ error: 'Failed to list quick replies' });
    }
  }

  /**
   * GET /api/quick-replies/categories
   */
  static async listCategories(req, res) {
    try {
      const { tenantId } = req.user;

      const categories = await QuickReplyService.listCategories(tenantId);

      res.json({ categories });
    } catch (error) {
      logger.error('List categories failed:', error);
      res.status(500).json({ error: 'Failed to list categories' });
    }
  }

  /**
   * GET /api/quick-replies/:shortcut
   */
  static async getByShortcut(req, res) {
    try {
      const { tenantId } = req.user;
      const { shortcut } = req.params;
      const variables = req.query; // Variáveis como query params

      const quickReply = await QuickReplyService.getProcessed(tenantId, shortcut, variables);

      res.json(quickReply);
    } catch (error) {
      logger.error('Get quick reply failed:', error);
      res.status(404).json({ error: error.message });
    }
  }

  /**
   * POST /api/quick-replies
   */
  static async create(req, res) {
    try {
      const { tenantId, role } = req.user;

      // Apenas ADMIN pode criar
      if (!['ADMIN', 'SUPERVISOR'].includes(role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const { title, shortcut, content, category } = req.body;

      if (!title || !shortcut || !content) {
        return res.status(400).json({
          error: 'Title, shortcut and content are required'
        });
      }

      // Validar shortcut format (deve começar com /)
      if (!shortcut.startsWith('/')) {
        return res.status(400).json({
          error: 'Shortcut must start with /'
        });
      }

      const quickReply = await QuickReplyService.create(tenantId, {
        title,
        shortcut,
        content,
        category
      });

      res.status(201).json(quickReply);
    } catch (error) {
      logger.error('Create quick reply failed:', error);

      if (error.message === 'Shortcut already exists') {
        return res.status(409).json({ error: error.message });
      }

      res.status(500).json({ error: 'Failed to create quick reply' });
    }
  }

  /**
   * PUT /api/quick-replies/:id
   */
  static async update(req, res) {
    try {
      const { tenantId, role } = req.user;
      const { id } = req.params;

      if (!['ADMIN', 'SUPERVISOR'].includes(role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const quickReply = await QuickReplyService.update(id, tenantId, req.body);

      res.json(quickReply);
    } catch (error) {
      logger.error('Update quick reply failed:', error);

      if (error.message === 'Quick reply not found') {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: 'Failed to update quick reply' });
    }
  }

  /**
   * DELETE /api/quick-replies/:id
   */
  static async delete(req, res) {
    try {
      const { tenantId, role } = req.user;
      const { id } = req.params;

      if (!['ADMIN', 'SUPERVISOR'].includes(role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      await QuickReplyService.delete(id, tenantId);

      res.json({ success: true });
    } catch (error) {
      logger.error('Delete quick reply failed:', error);

      if (error.message === 'Quick reply not found') {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: 'Failed to delete quick reply' });
    }
  }
}

module.exports = QuickReplyController;
