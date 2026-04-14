/**
 * Internal Note Routes
 */

const express = require('express');
const router = express.Router();
const InternalNoteController = require('../controllers/InternalNoteController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Deletar nota
router.delete('/:noteId', InternalNoteController.delete);

module.exports = router;
