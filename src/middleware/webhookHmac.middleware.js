/**
 * webhookHmac.middleware.js
 *
 * Middleware para validação de HMAC em webhooks do Meta
 *
 * Meta envia cada webhook com header X-Hub-Signature-256
 * Contém: sha256=HMAC(app_secret, body)
 *
 * Isso garante:
 * ✅ Webhook é realmente do Meta (não forjado)
 * ✅ Body não foi alterado em trânsito
 * ✅ Cada tenant usa seu próprio metaAppSecret
 */

const crypto = require('crypto');
const prisma = require('../services/database');
const logger = require('../utils/logger');

/**
 * Middleware: Validar HMAC de webhooks Meta
 *
 * Fluxo:
 * 1. Extrai waPhoneId do body
 * 2. Busca tenant pelo waPhoneId
 * 3. Busca metaAppSecret da Configuration do tenant
 * 4. Calcula HMAC esperado: sha256=HMAC(metaAppSecret, rawBody)
 * 5. Compara com header X-Hub-Signature-256
 * 6. Se inválido, rejeita (403)
 */
const validateWebhookHmac = async (req, res, next) => {
  try {
    logger.debug('[Webhook HMAC] Processing webhook request');

    // 1. Buscar assinatura do Meta (header)
    const signature = req.headers['x-hub-signature-256'];

    if (!signature) {
      logger.warn('[Webhook HMAC] Missing X-Hub-Signature-256 header');
      return res.status(403).json({
        error: 'Invalid webhook signature',
        details: 'Missing X-Hub-Signature-256 header'
      });
    }

    logger.debug('[Webhook HMAC] Signature header found (masked for security)');

    // 2. Validar que req.rawBody existe
    // (server.js deve ter sido configurado para capturar)
    if (!req.rawBody) {
      logger.error('[Webhook HMAC] req.rawBody not available - server configuration error');
      return res.status(500).json({
        error: 'Server configuration error',
        details: 'rawBody not captured'
      });
    }

    logger.debug('[Webhook HMAC] Raw body received, parsing payload');

    // Extrair waPhoneId e wabaId do body para identificar a conexão
    let waPhoneId;
    let wabaId;
    try {
      const bodyData = JSON.parse(req.rawBody);
      waPhoneId = bodyData?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      wabaId = bodyData?.entry?.[0]?.id;
      logger.debug('[Webhook HMAC] Payload parsed successfully');
    } catch (e) {
      logger.warn('[Webhook HMAC] Invalid JSON in webhook body');
      return res.status(400).json({
        error: 'Invalid request body',
        details: 'Body is not valid JSON'
      });
    }

    if (!waPhoneId && !wabaId) {
      logger.warn('[Webhook HMAC] Missing phone_number_id and wabaId in webhook');
      return res.status(400).json({
        error: 'Invalid webhook structure',
        details: 'No phone_number_id or wabaId found in payload'
      });
    }

    const tenantIdParam = req.params.tenantId;
    let config;

    if (tenantIdParam) {
      // 3a. Use explicit tenant ID from URL
      logger.debug(`[Webhook HMAC] Explicit tenantId provided in URL: ${tenantIdParam}`);
      
      const whereClause = { tenantId: tenantIdParam };
      if (waPhoneId) {
        whereClause.phoneNumberId = waPhoneId;
      }
      
      config = await prisma.configuration.findFirst({
        where: whereClause,
        include: { tenant: true }
      });

      if (!config || !config.tenant) {
        logger.warn(`[Webhook HMAC] Webhook for unknown tenantId/phoneId combination: ${tenantIdParam} / ${waPhoneId || 'N/A'} - rejected`);
        return res.status(403).json({
          error: 'Invalid tenant or phone connection',
          details: 'Unknown tenantId or phone_number_id combination'
        });
      }
    } else {
      // 3b. Global Webhook: Resolver tenant pelo waPhoneId ou wabaId
      if (waPhoneId) {
        config = await prisma.configuration.findUnique({
          where: { phoneNumberId: waPhoneId },
          include: { tenant: true }
        });
      } else if (wabaId) {
        // Fallback for WABA-level events that lack phone_number_id
        config = await prisma.configuration.findFirst({
          where: { wabaId: wabaId },
          include: { tenant: true }
        });
      }

      if (!config || !config.tenant) {
        logger.warn(`[Webhook HMAC] Webhook from unknown phone_number_id (${waPhoneId}) or wabaId (${wabaId}) - rejected`);
        return res.status(403).json({
          error: 'Invalid tenant',
          details: 'Unknown phone_number_id or wabaId'
        });
      }
    }

    const tenant = config.tenant;

    logger.debug('[Webhook HMAC] Configuration found for tenant, validating HMAC');

    if (!config.metaAppSecret) {
      logger.error('[Webhook HMAC] Tenant metaAppSecret not configured');
      return res.status(500).json({
        error: 'Configuration incomplete',
        details: 'metaAppSecret not configured'
      });
    }

    // 5. Calcular HMAC esperado
    logger.debug('[Webhook HMAC] Validating HMAC signature');
    const expectedHmac = crypto
      .createHmac('sha256', config.metaAppSecret)
      .update(req.rawBody, 'utf8')
      .digest('hex');

    const expectedSignature = `sha256=${expectedHmac}`;

    // 7. Validar assinatura (usar timingSafeEqual para evitar timing attacks)
    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch (e) {
      // Length mismatch - signatures não coincidem
      isValid = false;
    }

    if (!isValid) {
      logger.error(`[Webhook HMAC] Invalid signature for tenant ${tenant.id} - Webhook rejected`);
      return res.status(403).json({
        error: 'Invalid webhook signature',
        details: 'HMAC validation failed'
      });
    }

    // 8. Se passou todas as validações, injeta tenantId e Config no request
    req.tenant = tenant;
    req.webhookConfig = config;

    logger.debug('[Webhook HMAC] ✅ Webhook HMAC validation passed');

    next();
  } catch (error) {
    logger.error('[Webhook HMAC] Unexpected error during validation');
    res.status(500).json({
      error: 'Internal server error',
      details: 'Webhook validation failed'
    });
  }
};

module.exports = { validateWebhookHmac };
