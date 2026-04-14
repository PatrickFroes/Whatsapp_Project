/**
 * Comprehensive Webhook Test for All Tenants
 * Tests each tenant with its own waPhoneId
 */

const http = require('http');
const crypto = require('crypto');
const prisma = require('./src/services/database');

async function testTenant(tenant, testNumber) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Test ${testNumber}/3: ${tenant.name.toUpperCase()}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Check if tenant has waPhoneId
  if (!tenant.waPhoneId) {
    console.log(`⚠️  Tenant has no waPhoneId configured - SKIPPING\n`);
    return { success: false, skipped: true };
  }

  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id }
  });

  if (!config?.metaAppSecret) {
    console.log(`❌ No Configuration or metaAppSecret - SKIPPING\n`);
    return { success: false, skipped: true };
  }

  // Create payload
  const PAYLOAD = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '2169447660256643',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15551455475',
                phone_number_id: tenant.waPhoneId
              },
              contacts: [
                {
                  profile: { name: 'Test Patrick' },
                  wa_id: '554198613849',
                  country_code: 'BR'
                }
              ],
              messages: [
                {
                  from: '554198613849',
                  id: `wamid.test_${tenant.id.substring(0, 8)}_${Date.now()}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: { body: `Test message for ${tenant.name}` },
                  type: 'text'
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };

  const rawBody = JSON.stringify(PAYLOAD);
  const hmac = crypto
    .createHmac('sha256', config.metaAppSecret)
    .update(rawBody)
    .digest('hex');

  const signature = `sha256=${hmac}`;

  console.log(`1️⃣  Tenant Info:`);
  console.log(`   ID: ${tenant.id}`);
  console.log(`   waPhoneId: ${tenant.waPhoneId}`);
  console.log(`   Has metaAppSecret: ✓\n`);

  console.log(`2️⃣  Sending webhook..`);

  // Send webhook
  const result = await new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody),
        'X-Hub-Signature-256': signature
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log(`   HTTP Status: ${res.statusCode} ✓`);
        resolve({ status: res.statusCode, success: res.statusCode === 200 });
      });
    });

    req.on('error', (error) => {
      console.error(`   Error: ${error.message}`);
      resolve({ success: false });
    });

    req.write(rawBody);
    req.end();
  });

  console.log(`\n3️⃣  Waiting for processing...`);
  await new Promise((r) => setTimeout(r, 2000));

  console.log(`\n4️⃣  Checking database...`);
  const messages = await prisma.message.findMany({
    where: { conversation: { tenantId: tenant.id } },
    select: { id: true, content: true, createdAt: true },
    take: 3,
    orderBy: { createdAt: 'desc' }
  });

  if (messages.length > 0) {
    console.log(`   ✅ Found ${messages.length} messages`);
    messages.slice(0, 2).forEach((m) => {
      console.log(`      - "${m.content}" (${new Date(m.createdAt).toLocaleTimeString()})`);
    });
  } else {
    console.log(`   ⚠️  No messages found`);
  }

  return result;
}

async function main() {
  console.log(`\n╔${'═'.repeat(58)}╗`);
  console.log(`║  COMPREHENSIVE WEBHOOK TEST - ALL TENANTS              ║`);
  console.log(`║  Date: ${new Date().toLocaleDateString('pt-BR')}                               ║`);
  console.log(`╚${'═'.repeat(58)}╝\n`);

  // Get all tenants with waPhoneId
  const tenants = await prisma.tenant.findMany({
    where: { waPhoneId: { not: null } },
    select: { id: true, name: true, waPhoneId: true }
  });

  if (tenants.length === 0) {
    console.log('❌ No tenants with waPhoneId found\n');
    process.exit(1);
  }

  console.log(`📊 Found ${tenants.length} tenant(s) with waPhoneId:\n`);
  tenants.forEach((t, idx) => {
    console.log(`   ${idx + 1}. ${t.name} (${t.waPhoneId})`);
  });

  // Run tests
  const results = [];
  for (let i = 0; i < tenants.length; i++) {
    try {
      const result = await testTenant(tenants[i], i + 1);
      results.push({
        name: tenants[i].name,
        ...result
      });
    } catch (error) {
      console.error(`Error testing ${tenants[i].name}:`, error.message);
      results.push({ name: tenants[i].name, success: false, error: true });
    }
  }

  // Summary
  console.log(`\n\n╔${'═'.repeat(58)}╗`);
  console.log(`║                    TEST SUMMARY                       ║`);
  console.log(`╚${'═'.repeat(58)}╝\n`);

  results.forEach((r) => {
    const status = r.skipped ? '⚠️ SKIPPED' : r.success ? '✅ PASSED' : '❌ FAILED';
    console.log(`  ${status}  ${r.name}`);
  });

  const passed = results.filter((r) => r.success).length;
  console.log(`\n  Total: ${passed}/${results.length} tests passed\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
