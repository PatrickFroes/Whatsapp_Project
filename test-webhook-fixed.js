#!/usr/bin/env node

const crypto = require('crypto');
const https = require('https');

const APP_SECRET = '5f15f81a7f3a8d4eb53a01920d60b959';
const PHONE_NUMBER_ID = '946528235219456';
const WEBHOOK_URL = 'https://broker.amber.com.br/webhook';

// Simular payload de mensagem WhatsApp com novo ID
const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '5511987654321',
              phone_number_id: PHONE_NUMBER_ID
            },
            contacts: [
              {
                profile: {
                  name: 'Teste User'
                },
                wa_id: '5511987654321'
              }
            ],
            messages: [
              {
                from: '5511987654321',
                id: 'wamid.test' + Date.now(),
                timestamp: Math.floor(Date.now() / 1000),
                type: 'text',
                text: {
                  body: 'Mensagem após correção'
                }
              }
            ]
          },
          field: 'messages'
        }
      ]
    }
  ]
};

const body = JSON.stringify(payload);

// Gerar HMAC-SHA256
const signature = 'sha256=' + crypto
  .createHmac('sha256', APP_SECRET)
  .update(body)
  .digest('hex');

console.log('\n📤 TEST: Nova mensagem com correções aplicadas\n');

const urlObj = new URL(WEBHOOK_URL);
const options = {
  hostname: urlObj.hostname,
  port: 443,
  path: urlObj.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Hub-Signature-256': signature
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`✅ Status: ${res.statusCode}`);
    console.log('Response:', data);
    process.exit(0);
  });
});

req.on('error', err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
