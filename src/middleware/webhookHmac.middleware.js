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
    console.log('[Webhook HMAC 🔍] New webhook request detected');
    console.log('[Webhook HMAC 🔍] URL:', req.originalUrl);
    console.log('[Webhook HMAC 🔍] Method:', req.method);
    
    // 1. Buscar assinatura do Meta (header)
    const signature = req.headers['x-hub-signature-256'];

    if (!signature) {
      console.warn('[Webhook HMAC] Missing X-Hub-Signature-256 header');
      console.warn('[Webhook HMAC] Available headers:', Object.keys(req.headers));
      return res.status(403).json({
        error: 'Invalid webhook signature',
        details: 'Missing X-Hub-Signature-256 header'
      });
    }
    
    console.log('[Webhook HMAC 🔍] Signature header found:', signature.substring(0, 20) + '...');

    // 2. Validar que req.rawBody existe
    // (server.js deve ter sido configurado para capturar)
    if (!req.rawBody) {
      console.error('[Webhook HMAC] req.rawBody not available');
      console.log('[Webhook HMAC 🔍] Body type:', typeof req.body);
      console.log('[Webhook HMAC 🔍] Body keys:', req.body ? Object.keys(req.body) : 'null');
      return res.status(500).json({
        error: 'Server configuration error',
        details: 'rawBody not captured'
      });
    }
    
    console.log('[Webhook HMAC 🔍] Raw body size:', req.rawBody.length, 'bytes');

    // 3. Extrair waPhoneId do body para identificar tenant
    let waPhoneId;
    try {
      const bodyData = JSON.parse(req.rawBody);
      waPhoneId = bodyData?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      console.log('[Webhook HMAC 🔍] Extracted waPhoneId:', waPhoneId || 'NOT FOUND');
      console.log('[Webhook HMAC 🔍] Full payload object:', bodyData.object);
      console.log('[Webhook HMAC 🔍] Entry count:', bodyData.entry?.length);
      if (bodyData.entry?.[0]?.changes?.[0]?.value?.messages) {
        console.log('[Webhook HMAC 🔍] Message count:', bodyData.entry[0].changes[0].value.messages.length);
      }
    } catch (e) {
      console.warn('[Webhook HMAC] Invalid JSON in body:', e.message);
      return res.status(400).json({
        error: 'Invalid request body',
        details: 'Body is not valid JSON'
      });
    }

    if (!waPhoneId) {
      console.warn('[Webhook HMAC] No phone_number_id in webhook');
      return res.status(400).json({
        error: 'Invalid webhook structure',
        details: 'No phone_number_id found in metadata'
      });
    }

    // 4. Buscar tenant pelo waPhoneId
    const tenant = await prisma.tenant.findFirst({
      where: { waPhoneId: waPhoneId }
    });

    if (!tenant) {
      console.warn(`[Webhook HMAC] ❌ No tenant found for waPhoneId: ${waPhoneId}`);
      // Debug: show all available tenants
      const allTenants = await prisma.tenant.findMany({
        select: { id: true, name: true, waPhoneId: true }
      });
      console.warn('[Webhook HMAC] Available tenants:', allTenants);
      // Retorna 403 para não alertar atacantes de que o waPhoneId é válido
      return res.status(403).json({
        error: 'Invalid tenant',
        details: 'Unknown phone_number_id'
      });
    }

    console.log(`[Webhook HMAC 🔍] ✓ Found tenant: ${tenant.name} (${tenant.id})`);

    // 5. Buscar Configuration do tenant (com metaAppSecret)
    const config = await prisma.configuration.findUnique({
      where: { tenantId: tenant.id }
    });

    if (!config) {
      console.error(
        `[Webhook HMAC] ❌ No Configuration found for tenant ${tenant.id} - Webhook rejected`
      );
      return res.status(500).json({
        error: 'Configuration incomplete',
        details: 'No configuration record exists for this tenant'
      });
    }
    
    console.log(`[Webhook HMAC 🔍] ✓ Found Configuration`);
    console.log(`[Webhook HMAC 🔍] phoneNumberId: ${config.phoneNumberId}`);
    console.log(`[Webhook HMAC 🔍] metaAppSecret: ${config.metaAppSecret ? 'SET ✓' : 'MISSING ❌'}`);

    if (!config.metaAppSecret) {
      console.error(
        `[Webhook HMAC] ❌ Missing metaAppSecret for tenant ${tenant.id} - Webhook rejected`
      );
      return res.status(500).json({
        error: 'Configuration incomplete',
        details: 'metaAppSecret not configured'
      });
    }

    // 6. Calcular HMAC esperado
    console.log('[Webhook HMAC 🔍] Calculating HMAC...');
    const expectedHmac = crypto
      .createHmac('sha256', config.metaAppSecret)
      .update(req.rawBody, 'utf8')
      .digest('hex');

    const expectedSignature = `sha256=${expectedHmac}`;
    
    console.log('[Webhook HMAC 🔍] Expected signature:', expectedSignature.substring(0, 30) + '...');
    console.log('[Webhook HMAC 🔍] Received signature:', signature.substring(0, 30) + '...');

    // 7. Validar assinatura (usar timingSafeEqual para evitar timing attacks)
    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch (e) {
      console.error('[Webhook HMAC 🔍] timingSafeEqual error (length mismatch?):', e.message);
      console.log('[Webhook HMAC 🔍] Expected length:', expectedSignature.length);
      console.log('[Webhook HMAC 🔍] Received length:', signature.length);
      isValid = false;
    }

    if (!isValid) {
      console.error(`[Webhook HMAC] ❌ Invalid signature for tenant ${tenant.id}`);
      console.log('[Webhook HMAC 🔍] Signature mismatch - webhook rejected');
      return res.status(403).json({
        error: 'Invalid webhook signature',
        details: 'HMAC validation failed'
      });
    }

    // 8. Se passou todas as validações, injeta tenantId e Config no request
    req.tenant = tenant;
    req.webhookConfig = config;

    console.log(`[Webhook HMAC] ✅ PASSED: Valid webhook from tenant: ${tenant.name}`);

    next();
  } catch (error) {
    console.error('[Webhook HMAC] Unexpected error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

module.exports = { validateWebhookHmac };
