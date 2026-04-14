/**
 * Business Hours Routes
 */

const express = require('express');
const router = express.Router();
const BusinessHoursController = require('../controllers/BusinessHoursController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Obter configuração
router.get('/', BusinessHoursController.getConfig);

// Atualizar configuração (ADMIN only)
router.put('/', BusinessHoursController.updateConfig);

// Verificar status atual
router.get('/status', BusinessHoursController.checkStatus);

// Horário formatado
router.get('/schedule-formatted', BusinessHoursController.getFormattedSchedule);

module.exports = router;
