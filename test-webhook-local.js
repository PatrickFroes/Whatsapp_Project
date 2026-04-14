// test-webhook-local.js
// Script para testar webhook endpoint localmente
const crypto = require('crypto');
const https = require('https');

const WEBHOOK_URL = 'https://broker.amber.com.br/webhook';
const META_APP_SECRET = process.env.META_APP_SECRET || 'YOUR_META_APP_SECRET';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'minha_senha_segura_webhook';
const PHONE_NUMBER_ID = '946528235219456';

console.log('\n=== WEBHOOK LOCAL TEST ===\n');

// Test 1: Verify endpoint (GET)
console.log('📝 [TESTE 1] Testando endpoint de verificação (GET)...\n');

const verifyUrl = `${WEBHOOK_URL}?hub.mode=subscribe&hub.challenge=test_challenge_123&hub.verify_token=${VERIFY_TOKEN}`;

https.get(verifyUrl, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
    console.log(`Response: ${data}`);
    
    if (res.statusCode === 200 && data === 'test_challenge_123') {
      console.log('✅ Endpoint de verificação funcionando!\n');
    } else {
      console.log('❌ Falha na verificação. Status esperado: 200, Response esperado: test_challenge_123\n');
    }
    
    // Test 2: Send test webhook (POST)
    console.log('📝 [TESTE 2] Simulando webhook POST com HMAC válido...\n');
    
    const webhookPayload = {
      entry: [
        {
          id: '946528235219456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '558412345678',
                  phone_number_id: PHONE_NUMBER_ID,
                  webhook_id: 'webhook_id_test'
                },
                messages: [
                  {
                    from: '558498765432',
                    id: 'wamid.test_123456',
                    timestamp: Date.now().toString().slice(0, 10),
                    type: 'text',
                    text: {
                      body: 'Teste webhook'
                    }
                  }
                ]
              },
              field: 'messages'
            }
          ],
          timestamp: Date.now().toString().slice(0, 10)
        }
      ]
    };

    const rawBody = JSON.stringify(webhookPayload);
    const hmac = crypto
      .createHmac('sha256', META_APP_SECRET)
      .update(rawBody)
      .digest('hex');
    
    const signature = `sha256=${hmac}`;

    console.log(`X-Hub-Signature-256: ${signature}\n`);

    const options = {
      hostname: 'broker.amber.com.br',
      path: '/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
        'Content-Length': Buffer.byteLength(rawBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
        if (res.statusCode === 200) {
          console.log('✅ Webhook POST aceito!\n');
        } else {
          console.log(`❌ Erro no POST: ${data}\n`);
        }
        
        console.log('=== FIM DOS TESTES ===\n');
        console.log('Próximos passos:');
        console.log('1. Se ambos testes passarem (✅), o webhook está funcionando');
        console.log('2. Verifique os logs: docker compose logs -f broker_app | grep -i webhook');
        console.log('3. Na aba de teste do Meta, use "Send Test Webhook" para enviar mensagens');
      });
    });

    req.on('error', (e) => {
      console.error(`Erro ao enviar webhook: ${e.message}`);
    });

    req.write(rawBody);
    req.end();
  });
}).on('error', (e) => {
  console.error(`Erro ao testar verificação: ${e.message}`);
  console.error('\nVerifique:');
  console.error('- Se o servidor está rodando');
  console.error('- Se o SSL está configurado corretamente');
  console.error('- Se a URL broker.amber.com.br está respondendo');
});
