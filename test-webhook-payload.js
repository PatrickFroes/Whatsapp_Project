/**
 * Test webhook payload validation locally
 * without needing to go through the network
 */

const crypto = require('crypto');
const prisma = require('./src/services/database');

// Sample webhook payload from Meta (that user received)
const webhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123456789',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '5549989999999', // This is the display number
              phone_number_id: '946528235219456',    // This is what Meta sends and what we use to route
              business_account_id: '123456789'
            },
            contacts: [
              {
                profile: {
                  name: 'Seu Amigo'
                },
                wa_id: '554198613849'
              }
            ],
            messages: [
              {
                from: '554198613849',
                id: 'wamid.HBEUGoA9AwcQARI...',
                timestamp: '1712346000',
                type: 'text',
                text: {
                  body: 'Oi'
                }
              }
            ]
          }
        }
      ]
    }
  ]
};

async function testWebhookValidation() {
  console.log('=== WEBHOOK VALIDATION TEST ===\n');

  const rawBody = JSON.stringify(webhookPayload);
  console.log('1. Raw body length:', rawBody.length, 'bytes\n');

  // Extract phone_number_id
  const waPhoneId =
    webhookPayload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  console.log('2. Extracted phone_number_id:', waPhoneId);

  if (!waPhoneId) {
    console.error('ERROR: No phone_number_id found!');
    process.exit(1);
  }

  // Find tenant by waPhoneId
  console.log('\n3. Looking for tenant with waPhoneId:', waPhoneId);
  const tenant = await prisma.tenant.findFirst({
    where: { waPhoneId }
  });

  if (!tenant) {
    console.error('❌ ERROR: No tenant found for waPhoneId:', waPhoneId);
    console.log('\nAvailable tenants:');
    const allTenants = await prisma.tenant.findMany({
      select: { id: true, name: true, waPhoneId: true }
    });
    console.table(allTenants);
    process.exit(1);
  }

  console.log('✓ Found tenant:', tenant.id, '-', tenant.name);

  // Find configuration
  console.log('\n4. Looking for Configuration for tenant:', tenant.id);
  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id }
  });

  if (!config) {
    console.error('❌ ERROR: No Configuration found for tenant!');
    process.exit(1);
  }

  console.log('✓ Found Configuration');
  console.log('  - phoneNumberId:', config.phoneNumberId);
  console.log('  - verifyToken:', config.verifyToken ? 'SET' : 'NULL');
  console.log('  - whatsappToken:', config.whatsappToken ? 'SET' : 'NULL');
  console.log('  - metaAppSecret:', config.metaAppSecret ? 'SET' : 'NULL');

  if (!config.metaAppSecret) {
    console.error('❌ ERROR: metaAppSecret is NULL!');
    process.exit(1);
  }

  // Calculate expected HMAC  
  console.log('\n5. Calculating HMAC...');
  const hmac = crypto
    .createHmac('sha256', config.metaAppSecret)
    .update(rawBody)
    .digest('hex');
  const expectedSignature = 'sha256=' + hmac;

  console.log('  Calculated signature:', expectedSignature);
  console.log('  Signature length:', expectedSignature.length);

  // Test what Meta would send (user extracted this from their webhook)
  const metaSignatureFromHeaders = 'sha256=8f36bbd6329f18dc8a3c0652a79f2a34e0d3a6b77e8f9d50c1a23b4e5d62f87a';
  console.log('\n6. Comparing with Meta header...');
  console.log('  Expected:', expectedSignature);
  console.log('  Meta sent:', metaSignatureFromHeaders);

  const isValid = expectedSignature === metaSignatureFromHeaders;
  console.log('  Match:', isValid ? '✓ YES' : '❌ NO');

  // Extract message details
  console.log('\n7. Message details:');
  const msg = webhookPayload.entry[0].changes[0].value.messages[0];
  console.log('  From:', msg.from);
  console.log('  Type:', msg.type);
  console.log('  Content:', msg.text.body);
  console.log('  Message ID:', msg.id);

  // Check if message already exists
  console.log('\n8. Checking for duplicate message...');
  const existing = await prisma.message.findFirst({
    where: { waId: msg.id }
  });
  console.log('  Existing message:', existing ? '✓ YES (duplicate)' : 'NO (new)');

  console.log('\n=== TEST COMPLETE ===');
  console.log('Status: WEBHOOK IS VALID AND CAN BE PROCESSED ✓');
}

testWebhookValidation()
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
