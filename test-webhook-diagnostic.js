/**
 * Webhook Diagnostic Tool - Local Testing
 * 
 * Use this to test webhook payload validation WITHOUT needing database
 * First, get metaAppSecret value from server and paste below
 */

const crypto = require('crypto');

// =====================================================
// CONFIGURATION - PASTE VALUES FROM SERVER HERE
// =====================================================

// Get this value from database: SELECT "metaAppSecret" FROM "Configuration" WHERE "tenantId" = 'testeempresa-id'
const META_APP_SECRET = process.env.META_APP_SECRET || 'YOUR_META_APP_SECRET_HERE';

// Get this from the X-Hub-Signature-256 header when webhook arrives
// Format: "sha256=XXXXXXXX..."
const X_HUB_SIGNATURE_FROM_META = process.env.X_HUB_SIGNATURE || null;

// =====================================================
// WEBHOOK PAYLOAD (from user)
// =====================================================

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
              display_phone_number: '5549989999999',
              phone_number_id: '946528235219456',
              business_account_id: '123456789'
            },
            contacts: [
              {
                profile: { name: 'Seu Amigo' },
                wa_id: '554198613849'
              }
            ],
            messages: [
              {
                from: '554198613849',
                id: 'wamid.HBEUGoA9AwcQARI_msg_' + Date.now(),
                timestamp: Math.floor(Date.now() / 1000).toString(),
                type: 'text',
                text: { body: 'Oi' }
              }
            ]
          }
        }
      ]
    }
  ]
};

// =====================================================
// DIAGNOSTICS
// =====================================================

console.log('╔════════════════════════════════════════════╗');
console.log('║       WEBHOOK DIAGNOSTICS                  ║');
console.log('╚════════════════════════════════════════════╝\n');

// 1. Validate payload structure
console.log('1️⃣  PAYLOAD STRUCTURE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━');

const extraction = {
  object: webhookPayload.object,
  phoneNumberId: webhookPayload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
  senderPhone: webhookPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from,
  messageType: webhookPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type,
  messageBody: webhookPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body,
  messageId: webhookPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
};

Object.entries(extraction).forEach(([key, value]) => {
  const status = value ? '✓' : '✗';
  console.log(`  ${status} ${key}: ${value || 'MISSING'}`);
});

if (!extraction.phoneNumberId || !extraction.senderPhone || !extraction.messageBody) {
  console.log('\n❌ ERROR: Required fields missing from payload!\n');
  process.exit(1);
}

// 2. Test HMAC calculation
console.log('\n2️⃣  HMAC VALIDATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━');

if (META_APP_SECRET === 'YOUR_META_APP_SECRET_HERE') {
  console.log('  ⚠️  META_APP_SECRET not configured');
  console.log('  Set via: export META_APP_SECRET="your_secret_from_database"');
  console.log('  Or edit META_APP_SECRET in this script\n');
} else {
  const rawBody = JSON.stringify(webhookPayload);
  console.log(`  Raw body size: ${rawBody.length} bytes`);

  const hmac = crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  const calculatedSignature = 'sha256=' + hmac;
  console.log(`  Calculated:    ${calculatedSignature}`);

  if (X_HUB_SIGNATURE_FROM_META) {
    const isValid = calculatedSignature === X_HUB_SIGNATURE_FROM_META;
    console.log(`  From Meta:      ${X_HUB_SIGNATURE_FROM_META}`);
    console.log(`  Match:          ${isValid ? '✓ VALID' : '✗ INVALID'}`);

    if (!isValid) {
      console.log('\n  ⚠️  HMAC mismatch! Possible causes:');
      console.log('    - Wrong metaAppSecret');
      console.log('    - Payload was modified after Meta signed it');
      console.log('    - Different JSON serialization (spacing, order)');
    }
  } else {
    console.log(`  From Meta:      (provide via X_HUB_SIGNATURE env var)`);
  }
}

// 3. Message processing logic
console.log('\n3️⃣  MESSAGE PROCESSING');
console.log('━━━━━━━━━━━━━━━━━━━━━━━');

const CONVERSATIONAL_TYPES = [
  'text', 'image', 'video', 'audio', 'document',
  'location', 'sticker', 'interactive', 'button', 'order'
];

const messageType = extraction.messageType;
const isConversational = CONVERSATIONAL_TYPES.includes(messageType);

console.log(`  Message type:   "${messageType}"`);
console.log(`  Conversational: ${isConversational ? '✓ YES (will process)' : '✗ NO (will skip)'}`);

if (isConversational) {
  console.log(`  Sender phone:   ${extraction.senderPhone}`);
  console.log(`  Message:        "${extraction.messageBody}"`);
  console.log(`  Message ID:     ${extraction.messageId}`);
  console.log(`\n  ℹ️  Would create/update:`);
  console.log(`    - Contact: ${extraction.senderPhone}`);
  console.log(`    - Conversation: BOT status for TesteEmpresa tenant`);
  console.log(`    - Message: Text message "${extraction.messageBody}"`);
}

// 4. Possible issues
console.log('\n4️⃣  POTENTIAL ISSUES');
console.log('━━━━━━━━━━━━━━━━━━━━━━━');

const issues = [];

if (META_APP_SECRET === 'YOUR_META_APP_SECRET_HERE') {
  issues.push('❌ metaAppSecret not configured');
}

if (!X_HUB_SIGNATURE_FROM_META) {
  issues.push('⚠️  X-Hub-Signature-256 header not checked');
}

if (extraction.phoneNumberId !== '946528235219456') {
  issues.push('❌ Phone number ID mismatch');
}

if (!isConversational) {
  issues.push('⚠️  Message type may not be processed (non-conversational)');
}

if (issues.length === 0) {
  console.log('  ✓ No obvious issues detected');
  console.log('\n  If webhook still not processing, check:');
  console.log('    1. Rate limiter (webhookLimiter middleware)');
  console.log('    2. Docker logs for error messages');
  console.log('    3. Configuration table data');
  console.log('    4. Nginx reverse proxy logs');
} else {
  issues.forEach(issue => console.log(`  ${issue}`));
}

// 5. Summary
console.log('\n5️⃣  NEXT STEPS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━');

console.log(`
1. Get metaAppSecret from server:
   ssh ... 'docker exec broker_app node -e "..."' \\
     > SELECT "metaAppSecret" FROM "Configuration"
   
2. Get X-Hub-Signature-256 header from Meta webhook:
   - Usually visible in webhook debugging logs
   - Format: sha256=XXXXXXXXXXXX
   
3. Set environment variables:
   export META_APP_SECRET="your_secret"
   export X_HUB_SIGNATURE="sha256=xxxxx"
   
4. Run this script again:
   node test-webhook-diagnostic.js
   
5. Check Docker logs:
   ssh ... 'docker logs broker_app --tail 100' | grep -i webhook
`);

console.log('╚════════════════════════════════════════════╝\n');
