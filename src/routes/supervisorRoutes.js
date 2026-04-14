const express = require('express');
const router = express.Router();
const SupervisorController = require('../controllers/SupervisorController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// Protege todas as rotas
router.use(authenticateToken);

// Permite acesso a Supervisores, Admins e Donos
const allowedRoles = ['SUPERVISOR', 'ADMIN', 'OWNER'];

// Dashboard da Equipe
router.get('/team', authorizeRole(allowedRoles), SupervisorController.getTeamOverview);

// Forçar Status (Ex: derrubar agente travado)
router.put(
  '/agent/:agentId/status',
  authorizeRole(allowedRoles),
  SupervisorController.forceAgentStatus
);

// Mesa de Controle (Monitoramento de Chats)
router.get('/live-chats', authorizeRole(allowedRoles), SupervisorController.getLiveConversations);

// Histórico de Conversas
router.get('/history', authorizeRole(allowedRoles), SupervisorController.getHistory);

module.exports = router;
