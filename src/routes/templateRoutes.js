const express = require('express');
const router = express.Router();
const TemplateController = require('../controllers/TemplateController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// GET /api/templates - List templates (accessible by agents and admins to send templates)
router.get('/', TemplateController.list);

// POST /api/templates/sync - Sincronizar templates (restricted to admins)
router.post('/sync', authorizeRole(['ADMIN', 'OWNER', 'SUPER_ADMIN']), TemplateController.sync);

module.exports = router;
