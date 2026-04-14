/**
 * Webhook Test - Direct simulation with real Meta payload
 * Execute inside Docker container
 */

const http = require('http');
const crypto = require('crypto');
const prisma = require('./src/services/database');

// Real Meta webhook payload
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
              phone_number_id: '946528235219456'
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
                id: 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUM2MjdCOTVENzk3MTEwOTY1RDFEREYyMkRDNjU3M0MA',
                timestamp: '1775581635',
                text: { body: 'Oi' },
                from_logical_id: '146084789796904',
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
  console.log('║     WEBHOOK TEST - REAL PAYLOAD           ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // 1. Get metaAppSecret
  console.log('1️⃣  Extracting metaAppSecret from Configuration...');
  const config = await prisma.configuration.findFirst({
    where: {
      tenant: {
        waPhoneId: '946528235219456'
      }
    },
    include: { tenant: { select: { name: true } } }
  });

  if (!config) {
    console.error('❌ Configuration not found for waPhoneId 946528235219456');
    process.exit(1);
  }

  console.log('✓ Found Configuration');
  console.log(`  - Tenant: ${config.tenant.name}`);
  console.log(`  - metaAppSecret: ${config.metaAppSecret ? 'SET ✓' : 'MISSING ❌'}`);

  // 2. Serialize payload exactly as it will be sent
  const rawBody = JSON.stringify(PAYLOAD);
  console.log(`\n2️⃣  Payload details`);
  console.log(`  - Size: ${rawBody.length} bytes`);
  console.log(`  - Phone ID: ${PAYLOAD.entry[0].changes[0].value.metadata.phone_number_id}`);
  console.log(`  - Message: "${PAYLOAD.entry[0].changes[0].value.messages[0].text.body}"`);

  // 3. Calculate HMAC
  console.log(`\n3️⃣  Calculating HMAC signature...`);
  const hmac = crypto
    .createHmac('sha256', config.metaAppSecret)
    .update(rawBody)
    .digest('hex');
  const signature = `sha256=${hmac}`;
  console.log(`✓ Signature: ${signature.substring(0, 40)}...`);

  // 4. Send HTTP request
  console.log(`\n4️⃣  Sending POST request to http://localhost:3001/webhook`);

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

  await new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(`✓ Response status: ${res.statusCode}`);
        if (data) {
          console.log(`✓ Response body: ${data.substring(0, 100)}`);
        }
        resolve();
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Request error: ${error.message}`);
      reject(error);
    });

    req.write(rawBody);
    req.end();
  });

  // 5. Wait for processing
  console.log(`\n5️⃣  Waiting 3 seconds for webhook processing...`);
  await new Promise((r) => setTimeout(r, 3000));

  // 6. Check if message was saved
  console.log(`\n6️⃣  Checking if message was saved...`);
  const message = await prisma.message.findFirst({
    where: {
      waId: 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUM2MjdCOTVENzk3MTEwOTY1RDFEREYyMkRDNjU3M0MA'
    },
    include: {
      conversation: {
        select: { 
          id: true, 
          status: true,
          contact: {
            select: { phone: true, name: true }
          }
        }
      }
    }
  });

  if (message) {
    console.log(`✅ MESSAGE SAVED!`);
    console.log(`  - ID: ${message.id}`);
    console.log(`  - Content: "${message.content}"`);
    console.log(`  - Contact: ${message.conversation.contact.name} (${message.conversation.contact.phone})`);
    console.log(`  - Conversation: ${message.conversation.id}`);
    console.log(`  - Status: ${message.conversation.status}`);
    console.log(`  - Created: ${message.createdAt}`);
  } else {
    console.log(`❌ MESSAGE NOT FOUND - webhook may have failed`);
    console.log(`  Expected waId: wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUM2MjdCOTVENzk3MTEwOTY1RDFEREYyMkRDNjU3M0MA`);

    // Show recent messages for debugging
    const recentMessages = await prisma.message.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      select: { id: true, waId: true, content: true, createdAt: true }
    });
    console.log(`\n  Recent messages in DB:`);
    recentMessages.forEach((m) => {
      console.log(`    - ${m.waId} | "${m.content.substring(0, 30)}..."`);
    });
  }

  console.log(`\n✅ TEST COMPLETE\n`);
  process.exit(message ? 0 : 1);
}

testWebhook().catch((err) => {
  console.error('❌ TEST ERROR:', err.message);
  process.exit(1);
});
