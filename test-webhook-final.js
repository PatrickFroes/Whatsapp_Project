/**
 * Test webhook with new payload from Meta
 */

const http = require('http');
const crypto = require('crypto');
const prisma = require('./src/services/database');

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
                id: 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUMzQ0U3RTEzRjI0MzlCMjFEMzMyQUU2ODk1NTdCN0UA',
                timestamp: '1775582919',
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
  console.log('║   WEBHOOK TEST - TESTEEMPRESA             ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  try {
    // 1. Get config
    console.log('1️⃣  Getting Configuration...');
    const config = await prisma.configuration.findFirst({
      where: {
        tenant: { waPhoneId: '946528235219456' }
      },
      include: { tenant: { select: { name: true } } }
    });

    if (!config) {
      console.error('❌ Configuration not found');
      process.exit(1);
    }

    console.log(`✓ Tenant: ${config.tenant.name}`);
    console.log(`✓ metaAppSecret: ${config.metaAppSecret ? 'SET' : 'MISSING'}`);

    // 2. Calculate HMAC
    const rawBody = JSON.stringify(PAYLOAD);
    const hmac = crypto
      .createHmac('sha256', config.metaAppSecret)
      .update(rawBody)
      .digest('hex');
    const signature = `sha256=${hmac}`;

    console.log(`\n2️⃣  HMAC Signature calculated`);
    console.log(`✓ First 40 chars: ${signature.substring(0, 40)}...`);

    // 3. Send webhook
    console.log(`\n3️⃣  Sending webhook POST...`);

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
        console.log(`✓ HTTP ${res.statusCode}`);
        res.on('end', resolve);
      });

      req.on('error', reject);
      req.write(rawBody);
      req.end();
    });

    // 4. Wait for processing
    console.log(`\n4️⃣  Waiting 3 seconds for processing...`);
    await new Promise((r) => setTimeout(r, 3000));

    // 5. Check message
    console.log(`\n5️⃣  Checking if message was saved...`);

    const message = await prisma.message.findFirst({
      where: {
        waId: 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUMzQ0U3RTEzRjI0MzlCMjFEMzMyQUU2ODk1NTdCN0UA'
      },
      include: {
        conversation: {
          select: {
            id: true,
            status: true,
            contact: { select: { name: true, phone: true } }
          }
        }
      }
    });

    if (message) {
      console.log('✅ MESSAGE SAVED!\n');
      console.log(`   ID: ${message.id}`);
      console.log(`   Content: "${message.content}"`);
      console.log(`   From: ${message.conversation.contact.name} (${message.conversation.contact.phone})`);
      console.log(`   Conversation: ${message.conversation.id}`);
      console.log(`   Status: ${message.conversation.status}`);
      console.log(`   Created: ${message.createdAt}`);
      console.log('\n✅✅✅ WEBHOOK FULLY WORKING ✅✅✅\n');
    } else {
      console.log('❌ MESSAGE NOT FOUND - webhook may have failed\n');
      
      // Debug: show last messages
      const last = await prisma.message.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { id: true, waId: true, content: true, createdAt: true }
      });
      
      if (last.length > 0) {
        console.log('Recent messages in DB:');
        last.forEach((m) => {
          console.log(`  - ${m.waId.substring(0, 30)}... | "${m.content.substring(0, 20)}..."`);
        });
      }
    }

    process.exit(message ? 0 : 1);
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testWebhook();
