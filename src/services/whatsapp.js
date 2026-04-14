const axios = require('axios');
const prisma = require('./database');

const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v18.0';

// Helper to get credentials from Configuration
async function getCredentials(tenant) {
  if (!tenant || !tenant.id) {
    console.error('[WhatsApp] No tenant provided');
    return null;
  }

  // Get Configuration for this tenant
  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id }
  });

  if (!config) {
    console.error(`[WhatsApp] No Configuration found for tenant: ${tenant.id}`);
    return null;
  }

  if (!config.phoneNumberId || !config.whatsappToken) {
    console.error(`[WhatsApp] Missing credentials for tenant: ${tenant.id}`, {
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
    console.error('[WhatsApp] Tenant not provided - cannot send message');
    return null;
  }

  const credentials = await getCredentials(tenant);

  if (!credentials) {
    console.error('[WhatsApp] Failed to get credentials for tenant', {
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
    const response = await axios({
      method: 'POST',
      url: `${credentials.url}/messages`,
      data: dataPayload,
      headers: { Authorization: `Bearer ${credentials.token}` }
    });
    console.log(`[WhatsApp] ✓ Mensagem enviada para ${to}`, {
      tenant: tenant.name,
      tenantId: tenant.id,
      phoneNumberId: credentials.phoneNumberId
    });
    return response.data;
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error(`[WhatsApp] ✗ Falha ao enviar para ${to}`, {
      tenant: tenant.name,
      tenantId: tenant.id,
      phoneNumberId: credentials.phoneNumberId,
      status: error.response?.status,
      error: errorData
    });
    // Don't throw to avoid crashing the FlowEngine loop, just log
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
