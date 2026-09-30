#!/bin/bash

# Script para testar webhook localmente no container
# Copia o arquivo Node para o container e executa

cat > /tmp/test-webhook.js << 'EONODESCRIPT'
const crypto = require('crypto');
const prisma = require('/app/src/services/database');

const webhookPayload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: '123456789',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '5549989999999',
          phone_number_id: '123456789012345',
          business_account_id: '123456789'
        },
        contacts: [{
          profile: { name: 'Seu Amigo' },
          wa_id: '5511999999999'
        }],
        messages: [{
          from: '5511999999999',
          id: 'wamid.HBEUGoA9AwcQARI_test_' + Date.now(),
          timestamp: Math.floor(Date.now() / 1000).toString(),
          type: 'text',
          text: { body: 'Oi' }
        }]
      }
    }]
  }]
};

async function test() {
  console.log('[TEST] Webhook Validation\n');
  
  const rawBody = JSON.stringify(webhookPayload);
  const waPhoneId = webhookPayload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  
  console.log('Phone ID:', waPhoneId);
  
  // Find tenant
  const tenant = await prisma.tenant.findFirst({ where: { waPhoneId } });
  if (!tenant) {
    console.log('[ERROR] Tenant not found');
    const allTenants = await prisma.tenant.findMany({ select: { id: true, name: true, waPhoneId: true } });
    console.log('Available:', allTenants);
    process.exit(1);
  }
  
  console.log('[OK] Tenant found:', tenant.name);
  
  // Find config
  const config = await prisma.configuration.findUnique({ where: { tenantId: tenant.id } });
  if (!config) {
    console.log('[ERROR] Configuration not found');
    process.exit(1);
  }
  
  console.log('[OK] Configuration found');
  console.log('  - phoneNumberId:', config.phoneNumberId);
  console.log('  - metaAppSecret:', config.metaAppSecret ? 'SET' : 'MISSING');
  
  if (!config.metaAppSecret) {
    console.log('[ERROR] metaAppSecret is null');
    process.exit(1);
  }
  
  // Calculate HMAC
  const hmac = crypto.createHmac('sha256', config.metaAppSecret).update(rawBody).digest('hex');
  const signature = 'sha256=' + hmac;
  console.log('[OK] HMAC:', signature);
  
  console.log('\n[SUCCESS] Webhook is valid and can be processed');
  process.exit(0);
}

test().catch(err => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
EONODESCRIPT

# Execute
echo "Running test in container..."
docker exec -i broker_app node /tmp/test-webhook.js
