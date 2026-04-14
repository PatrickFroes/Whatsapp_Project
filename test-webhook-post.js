/**
 * Teste de POST com HMAC válido
 * Simula mensagem do Meta
 */

const crypto = require('crypto');

// APP_SECRET da Configuration
const APP_SECRET = 'seu_app_secret_aqui'; // Você precisa fornecer

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '100000000',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '5511999999999',
              phone_number_id: '946528235219456'
            },
            messages: [
              {
                from: '5511999999999',
                id: 'wamid.test' + Date.now(),
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: 'Teste de mensagem - ' + new Date().toISOString() }
              }
            ]
          },
          field: 'messages'
        }
      ]
    }
  ]
};

const bodyString = JSON.stringify(payload);

// Calcular HMAC
const signature = 'sha256=' + crypto
  .createHmac('sha256', APP_SECRET)
  .update(bodyString)
  .digest('hex');

console.log('🧪 Teste de POST com HMAC');
console.log('URL: https://broker.amber.com.br/webhook');
console.log('Signature:', signature);
console.log('Payload:', JSON.stringify(payload, null, 2).split('\n').slice(0, 5).join('\n') + '...');
console.log('\nPara executar com curl:');
console.log(`curl -X POST https://broker.amber.com.br/webhook \\`);
console.log(`  -H "x-hub-signature-256: ${signature}" \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '${bodyString}'`);
