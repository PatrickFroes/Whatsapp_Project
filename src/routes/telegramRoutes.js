const express = require('express');
const router = express.Router();
const TelegramWebhookController = require('../controllers/TelegramWebhookController');
const TelegramConfigController = require('../controllers/TelegramConfigController');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// 1. Rota Pública do Webhook do Telegram (Não requer JWT, o Telegram envia diretamente)
router.post('/webhooks/telegram/:tenantId', TelegramWebhookController.handleWebhook);

// 2. Rotas Protegidas de Configuração do Telegram (Admin / Super Admin)
router.get('/telegram/config', authenticateToken, authorizeRole(['ADMIN', 'OWNER', 'SUPER_ADMIN']), TelegramConfigController.getConfig);
router.post('/telegram/config', authenticateToken, authorizeRole(['ADMIN', 'OWNER', 'SUPER_ADMIN']), TelegramConfigController.saveConfig);
router.delete('/telegram/config', authenticateToken, authorizeRole(['ADMIN', 'OWNER', 'SUPER_ADMIN']), TelegramConfigController.disconnect);

module.exports = router;
