/**
 * Quick webhook test with new Meta payload
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
                id: 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUM2N0M4RjUxOTU5ODhCMjMyNjU2RDM0REU5MzhCQzcA',
                timestamp: '1775583876',
                text: { body: 'Fugg' },
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

async function test() {
  try {
    // Get config
    const config = await prisma.configuration.findFirst({
      where: { tenant: { waPhoneId: '946528235219456' } }
    });

    if (!config) {
      console.log('❌ Config not found');
      process.exit(1);
    }

    // Send webhook
    const rawBody = JSON.stringify(PAYLOAD);
    const hmac = crypto.createHmac('sha256', config.metaAppSecret).update(rawBody).digest('hex');
    const signature = `sha256=${hmac}`;

    console.log('📤 Sending webhook: "Fugg"');

    await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port: 3001,
          path: '/webhook',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawBody),
            'X-Hub-Signature-256': signature
          }
        },
        (res) => {
          console.log(`✓ HTTP ${res.statusCode}`);
          res.on('end', resolve);
        }
      );
      req.write(rawBody);
      req.end();
    });

    // Wait
    await new Promise((r) => setTimeout(r, 2000));

    // Check
    const msg = await prisma.message.findFirst({
      where: { waId: 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUM2N0M4RjUxOTU5ODhCMjMyNjU2RDM0REU5MzhCQzcA' }
    });

    if (msg) {
      console.log(`✅ Message saved: "${msg.content}"\n`);
    } else {
      console.log('❌ Message NOT saved\n');
    }

    // Show all messages
    const all = await prisma.message.findMany({ orderBy: { createdAt: 'desc' } });
    console.log(`Total messages in DB: ${all.length}`);
    all.forEach((m, i) => {
      console.log(`  ${i + 1}. "${m.content}"`);
    });

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

test();
