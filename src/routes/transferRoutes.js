/**
 * Transfer Routes
 */

const express = require('express');
const router = express.Router();
const TransferController = require('../controllers/TransferController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Listar agentes disponíveis
router.get('/available-agents', TransferController.getAvailableAgents);

// Listar skills disponíveis para transferência
router.get('/available-skills', TransferController.getAvailableSkills);

// Estatísticas de transferências de um agente (somente supervisores+)
router.get(
  '/users/:userId/stats',
  authorizeRole(['SUPERVISOR', 'ADMIN', 'OWNER', 'SUPER_ADMIN']),
  TransferController.getAgentStats
);

module.exports = router;
