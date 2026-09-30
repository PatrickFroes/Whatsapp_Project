const express = require('express');
const router = express.Router();
const SupervisorController = require('../controllers/SupervisorController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');
const prisma = require('../services/database');

// Protege todas as rotas
router.use(authenticateToken);

// Permite acesso a Supervisores, Admins e Donos
const allowedRoles = ['SUPERVISOR', 'ADMIN', 'OWNER'];

// Rota de depuração
router.get('/debug', authorizeRole(allowedRoles), async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const allConversationsCount = await prisma.conversation.count();
    const tenantConversationsCount = await prisma.conversation.count({ where: { tenantId } });
    const allUsersCount = await prisma.user.count();
    const tenantUsersCount = await prisma.user.count({ where: { tenantId } });
    const tenantAgentsCount = await prisma.user.count({ where: { tenantId, role: 'AGENT' } });
    
    const sampleConversations = await prisma.conversation.findMany({
      where: { tenantId },
      take: 5,
      select: { id: true, status: true, contact: { select: { phone: true } } }
    });

    res.json({
      success: true,
      currentUser: req.user,
      allConversationsCount,
      tenantConversationsCount,
      allUsersCount,
      tenantUsersCount,
      tenantAgentsCount,
      sampleConversations
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// Painel de Métricas (Dashboard)
router.get('/dashboard-stats', authorizeRole(allowedRoles), SupervisorController.getDashboardStats);

// Disparo em Massa ("Fire and Forget")
router.post(
  '/mass-send',
  authorizeRole(allowedRoles),
  SupervisorController.massSend
);

// Relatórios de Conversas
router.get('/reports', authorizeRole(allowedRoles), SupervisorController.getReports);

module.exports = router;
