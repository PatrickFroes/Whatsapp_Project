const express = const logger = require('../utils/logger');
const 'express');
const router = express.Router();
const WebhookController = require('../controllers/WebhookController');
const { validateWebhookHmac } = require('../middleware/webhookHmac.middleware');
const { webhookLimiter } = require('../middleware/rateLimiters');

/**
 * Webhook Routes
 *
 * GET  / - Verificação de endpoint (Meta valida que está ativo)
 * POST / - Receber eventos de webhook (validado por HMAC)
 *
 * Fluxo de Segurança:
 * 1. GET: Meta envia challenge, respondemos para confirmar que estamos ouvindo
 * 2. POST: Meta envia eventos assinados com X-Hub-Signature-256
 *    - Middleware validateWebhookHmac:
 *      a) Extrai waPhoneId do payload
 *      b) Busca tenant pelo waPhoneId
 *      c) Busca metaAppSecret da Configuration do tenant
 *      d) Valida HMAC contra metaAppSecret do tenant
 *      e) Injeta req.tenant e req.webhookConfig
 *    - WebhookController.handle() processa evento autenticado
 */

// Debug logging middleware
router.use((req, res, next) => {
  logger.debug(`[Webhook Route] ${req.method} request received at ${new Date().toISOString()}`);
  next();
});

router.get('/', (req, res, next) => {
  logger.debug('[Webhook GET] Verification request:', req.query);
  WebhookController.verify(req, res, next);
});

// Suportar também /whatsapp para compatibilidade
router.get('/whatsapp', (req, res, next) => {
  logger.debug('[Webhook GET /whatsapp] Verification request:', req.query);
  WebhookController.verify(req, res, next);
});

router.post('/', (req, res, next) => {
  logger.debug('[Webhook POST] Event received, passing to webhookLimiter');
  next();
}, webhookLimiter, (req, res, next) => {
  logger.debug('[Webhook POST] Passed rate limiter, validating HMAC');
  next();
}, validateWebhookHmac, WebhookController.handle);

// Suportar também /whatsapp para POST
router.post('/whatsapp', (req, res, next) => {
  logger.debug('[Webhook POST /whatsapp] Event received, passing to webhookLimiter');
  next();
}, webhookLimiter, (req, res, next) => {
  logger.debug('[Webhook POST /whatsapp] Passed rate limiter, validating HMAC');
  next();
}, validateWebhookHmac, WebhookController.handle);

module.exports = router;
