/**
 * Webhook Test - Parametrized for any tenant
 * Usage: node test-webhook-param.js [phone_number_id] [message_text]
 * Defaults: phone_number_id=946528235219456, message="Oi"
 */

const http = require('http');
const crypto = require('crypto');
const prisma = require('./src/services/database');

const PHONE_ID = process.argv[2] || '946528235219456';
const MESSAGE_TEXT = process.argv[3] || 'Oi';

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
              phone_number_id: PHONE_ID
            },
            contacts: [
              {
                profile: { name: 'Patrick' },
                wa_id: '554198613849',
                country_code: 'BR'
              }
            ],
            messages: [
              {
                from: '554198613849',
                id: 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUM2MjdCOTVENzk3MTEwOTY1RDFEREYyMkRDNjU3M0' + Math.random().toString(36).substring(7),
                timestamp: Math.floor(Date.now() / 1000).toString(),
                text: { body: MESSAGE_TEXT },
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

async function testWebhook() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     WEBHOOK TEST - PARAMETRIZED           ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // 1. Find tenant by waPhoneId
  console.log(`1️⃣  Finding tenant with waPhoneId: ${PHONE_ID}`);
  const tenant = await prisma.tenant.findFirst({
    where: { waPhoneId: PHONE_ID },
    include: {
      configuration: {
        select: {
          phoneNumberId: true,
          metaAppSecret: true,
          verifyToken: true
        }
      }
    }
  });

  if (!tenant) {
    console.error(`❌ No tenant found for waPhoneId: ${PHONE_ID}`);
    console.log('\n📋 Available tenants:');
    const allTenants = await prisma.tenant.findMany({
      select: { id: true, name: true, waPhoneId: true }
    });
    allTenants.forEach((t) => {
      console.log(`   - ${t.name} | waPhoneId: ${t.waPhoneId}`);
    });
    process.exit(1);
  }

  console.log(`✓ Found: ${tenant.name}`);
  console.log(`  - ID: ${tenant.id}`);
  console.log(`  - waPhoneId: ${tenant.waPhoneId}`);

  if (!tenant.configuration?.metaAppSecret) {
    console.error('❌ metaAppSecret not configured');
    process.exit(1);
  }

  // 2. Prepare payload
  console.log(`\n2️⃣  Preparing webhook payload`);
  const rawBody = JSON.stringify(PAYLOAD);
  console.log(`✓ Payload size: ${rawBody.length} bytes`);
  console.log(`✓ Message text: "${MESSAGE_TEXT}"`);

  // 3. Calculate HMAC
  console.log(`\n3️⃣  Calculating HMAC signature`);
  const hmac = crypto
    .createHmac('sha256', tenant.configuration.metaAppSecret)
    .update(rawBody)
    .digest('hex');
  const signature = `sha256=${hmac}`;
  console.log(`✓ Signature: ${signature.substring(0, 40)}...`);

  // 4. Send webhook
  console.log(`\n4️⃣  Sending webhook to http://localhost:3001/webhook`);

  await new Promise((resolve, reject) => {
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
        console.log(`✓ HTTP ${res.statusCode}`);
        resolve();
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Error: ${error.message}`);
      reject(error);
    });

    req.write(rawBody);
    req.end();
  });

  // 5. Wait for processing
  console.log(`\n5️⃣  Waiting 3 seconds for processing...`);
  await new Promise((r) => setTimeout(r, 3000));

  // 6. Check messages table
  console.log(`\n6️⃣  Checking database for saved messages...`);
  const messages = await prisma.message.findMany({
    where: { conversation: { tenantId: tenant.id } },
    include: {
      conversation: { select: { id: true, status: true } }
    },
    take: 5,
    orderBy: { createdAt: 'desc' }
  });

  if (messages.length > 0) {
    console.log(`✓ Found ${messages.length} messages for ${tenant.name}`);
    messages.forEach((msg, idx) => {
      console.log(`\n  Message ${idx + 1}:`);
      console.log(`    - Content: "${msg.content}"`);
      console.log(`    - Created: ${msg.createdAt}`);
      console.log(`    - Conversation: ${msg.conversation.status}`);
    });
  } else {
    console.log(`⚠️  No messages found for tenant ${tenant.name}`);
  }

  console.log(`\n✅ TEST COMPLETE\n`);
  process.exit(0);
}

testWebhook().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
