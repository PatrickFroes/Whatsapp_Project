const express = require('express');
const router = express.Router();
const HistoryController = require('../controllers/HistoryController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Todos os endpoints requerem autenticação
router.use(authenticateToken);

// Buscar sessões de um contato
router.get('/contact/:phone', HistoryController.getContactSessions);

// Buscar resumo do contato
router.get('/contact/:phone/summary', HistoryController.getContactSummary);

// Buscar mensagens de uma sessão específica
router.get('/session/:sessionId', HistoryController.getSessionMessages);

module.exports = router;
