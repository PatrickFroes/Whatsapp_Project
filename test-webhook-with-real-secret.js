// test-webhook-with-real-secret.js
// Testa webhook usando o metaAppSecret real do banco

const crypto = require('crypto');
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const WEBHOOK_URL = 'https://broker.amber.com.br/webhook';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'minha_senha_segura_webhook';
const PHONE_NUMBER_ID = '946528235219456';

const prisma = new PrismaClient();

async function testWebhook() {
  try {
    console.log('\n=== WEBHOOK TEST COM SECRET REAL ===\n');

    // 1. Buscar a Configuration real do banco
    console.log('📝 Buscando Configuration no banco...');
    const config = await prisma.configuration.findFirst();

    if (!config || !config.metaAppSecret) {
      console.log('❌ Nenhuma Configuration ou metaAppSecret encontrado');
      await prisma.$disconnect();
      return;
    }

    console.log(`✅ Encontrada Configuration para tenant: ${config.tenantId}`);
    console.log(`   metaAppSecret (primeiros 10 chars): ${config.metaAppSecret.substring(0, 10)}...`);
    console.log(`   phoneNumberId: ${config.phoneNumberId}\n`);

    // 2. Criar payload do webhook
    const webhookPayload = {
      entry: [
        {
          id: config.phoneNumberId,
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
                      body: 'Teste webhook com secret real'
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

    // 3. Calcular HMAC com o secret real
    const hmac = crypto
      .createHmac('sha256', config.metaAppSecret)
      .update(rawBody)
      .digest('hex');

    const signature = `sha256=${hmac}`;

    console.log('📝 Simulando webhook POST com HMAC REAL...\n');
    console.log(`X-Hub-Signature-256: ${signature}\n`);

    // 4. Enviar POST
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
          console.log('✅ Webhook POST ACEITO!\n');
          console.log('=== SUCESSO ===');
          console.log('O webhook está funcionando corretamente.');
          console.log('\nPróximos passos:');
          console.log('1. Verifique os logs: docker compose logs -f broker_app | grep webhook');
          console.log('2. Verifique se as mensagens foram salvas no banco');
          console.log('3. Na aba de teste do Meta, use "Send Test Webhook" para enviar mensagens reais');
        } else {
          console.log(`Response: ${data}`);
          console.log('❌ Webhook POST rejeitado');
        }
        
        prisma.$disconnect();
      });
    });

    req.on('error', (e) => {
      console.error(`Erro ao enviar webhook: ${e.message}`);
      prisma.$disconnect();
    });

    req.write(rawBody);
    req.end();

  } catch (error) {
    console.error('Erro:', error.message);
    await prisma.$disconnect();
  }
}

testWebhook();
