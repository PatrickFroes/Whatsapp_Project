const logger = require('../utils/logger');
const axios = require('axios');
const prisma = require('./database');

const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v18.0';
const META_API_TIMEOUT_MS = parseInt(process.env.META_API_TIMEOUT_MS || '15000', 10);

// Helper to get credentials from Configuration with tenant verification
async function getCredentials(tenant) {
  if (!tenant || !tenant.id) {
    logger.error('[WhatsApp] No tenant provided');
    return null;
  }

  // Get Configuration for this tenant
  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id },
    select: {
      tenantId: true,
      phoneNumberId: true,
      whatsappToken: true
    }
  });

  if (!config) {
    logger.error(`[WhatsApp] No Configuration found for tenant: ${tenant.id}`);
    return null;
  }

  // ✅ SECURITY: Verify tenant ownership
  if (config.tenantId !== tenant.id) {
    logger.error('[WhatsApp] SECURITY: Tenant ID mismatch - possible cross-tenant access attempt', {
      configTenantId: config.tenantId,
      requestedTenantId: tenant.id
    });
    return null;
  }

  if (!config.phoneNumberId || !config.whatsappToken) {
    logger.warn(`[WhatsApp] Missing credentials for tenant: ${tenant.id}`, {
      phoneNumberId: config.phoneNumberId ? '✓' : '✗ MISSING',
      whatsappToken: config.whatsappToken ? '✓' : '✗ MISSING'
    });
    return null;
  }

  return {
    url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${config.phoneNumberId}`,
    token: config.whatsappToken,
    phoneNumberId: config.phoneNumberId
  };
}

async function sendMessage(to, content, tenant = null) {
  if (!tenant) {
    logger.error('[WhatsApp] Tenant not provided - cannot send message');
    return null;
  }

  const credentials = await getCredentials(tenant);

  if (!credentials) {
    logger.error('[WhatsApp] Failed to get credentials for tenant', {
      tenantId: tenant.id,
      tenantName: tenant.name
    });
    return null;
  }

  // Determine payload type
  const dataPayload = {
    messaging_product: 'whatsapp',
    to: to
  };

  if (typeof content === 'string') {
    dataPayload.type = 'text';
    dataPayload.text = { body: content };
  } else if (typeof content === 'object') {
    // Assuming content is { type: 'interactive', interactive: { ... } } or similar
    Object.assign(dataPayload, content);
  }

  try {
    // ✅ Add timeout protection
    const response = await axios({
      method: 'POST',
      url: `${credentials.url}/messages`,
      data: dataPayload,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json'
      },
      timeout: META_API_TIMEOUT_MS
    });

    logger.debug(`[WhatsApp] ✓ Message sent to ${to}`, {
      tenant: tenant.name,
      tenantId: tenant.id,
      phoneNumberId: credentials.phoneNumberId,
      status: response.status
    });

    return response.data;
  } catch (error) {
    // ✅ Categorize errors for better debugging and recovery
    const status = error.response?.status;
    const errorData = error.response?.data || { message: error.message };

    // Timeout error
    if (error.code === 'ECONNABORTED') {
      logger.error(`[WhatsApp] ✗ Timeout sending to ${to} (${META_API_TIMEOUT_MS}ms exceeded)`, {
        tenant: tenant.name,
        tenantId: tenant.id,
        phoneNumberId: credentials.phoneNumberId,
        error: error.message
      });
      return null;
    }

    // Authentication error
    if (status === 401) {
      logger.error(`[WhatsApp] ✗ Authentication failed for ${to} (401)`, {
        tenant: tenant.name,
        tenantId: tenant.id,
        error: 'Invalid or expired WhatsApp token',
        details: errorData.error?.message
      });
      return null;
    }

    // Rate limiting
    if (status === 429) {
      logger.warn(`[WhatsApp] ✗ Rate limit exceeded for ${to}`, {
        tenant: tenant.name,
        tenantId: tenant.id,
        retryAfter: error.response?.headers['retry-after']
      });
      return null;
    }

    // Server error
    if (status >= 500) {
      logger.error(`[WhatsApp] ✗ Server error (${status}) sending to ${to}`, {
        tenant: tenant.name,
        tenantId: tenant.id,
        phoneNumberId: credentials.phoneNumberId,
        error: errorData
      });
      return null;
    }

    // Other client errors
    if (status && status >= 400) {
      logger.error(`[WhatsApp] ✗ Client error (${status}) sending to ${to}`, {
        tenant: tenant.name,
        tenantId: tenant.id,
        phoneNumberId: credentials.phoneNumberId,
        error: errorData.error?.message || errorData.message
      });
      return null;
    }

    // Network error
    logger.error(`[WhatsApp] ✗ Network error sending to ${to}`, {
      tenant: tenant.name,
      tenantId: tenant.id,
      phoneNumberId: credentials.phoneNumberId,
      error: error.message
    });
    return null;
  }
}

module.exports = { sendMessage };

// Futuro: Implementar envio de Templates aqui
async function sendTemplate(to, templateName, languageCode = 'pt_BR') {
  // Implementação futura para "Active Notifications"
}

module.exports = {
  sendMessage,
  sendTemplate
};
