/**
 * Quick Reply Routes
 */

const express = require('express');
const router = express.Router();
const QuickReplyController = require('../controllers/QuickReplyController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar quick replies
router.get('/', QuickReplyController.list);

// Listar categorias
router.get('/categories', QuickReplyController.listCategories);

// Buscar por shortcut (com variáveis)
router.get('/:shortcut', QuickReplyController.getByShortcut);

// Criar quick reply (ADMIN/SUPERVISOR)
router.post('/', QuickReplyController.create);

// Atualizar quick reply (ADMIN/SUPERVISOR)
router.put('/:id', QuickReplyController.update);

// Deletar quick reply (ADMIN/SUPERVISOR)
router.delete('/:id', QuickReplyController.delete);

module.exports = router;
