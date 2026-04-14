/**
 * Teste de diagnóstico de webhook
 * Verifica se o endpoint está respondendo e se a validação HMAC funciona
 */

const http = require('http');
const crypto = require('crypto');

// Simular payload do Meta
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
                text: { body: 'Teste de webhook ' + new Date().toLocaleTimeString() }
              }
            ]
          },
          field: 'messages'
        }
      ]
    }
  ]
};

// Obter a chave de app secret (você precisa fornecer ou obter do banco)
const APP_SECRET = process.env.META_APP_SECRET || 'seu_app_secret_aqui';

const bodyString = JSON.stringify(payload);
const signature = 'sha256=' + crypto
  .createHmac('sha256', APP_SECRET)
  .update(bodyString)
  .digest('hex');

console.log('🧪 [WEBHOOK DIAGNOSTIC TEST]\n');
console.log('📍 Enviando webhook para http://localhost:3000/webhook/whatsapp');
console.log('📦 Payload:', JSON.stringify(payload, null, 2).substring(0, 200) + '...');
console.log('🔐 Signature:', signature);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/webhook/whatsapp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyString),
    'x-hub-signature-256': signature
  }
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\n✅ [RESPONSE]');
    console.log('   Status:', res.statusCode);
    console.log('   Body:', data);
    
    if (res.statusCode === 200) {
      console.log('\n✅ Webhook processado com sucesso!');
      console.log('   Próximo: Verificar banco de dados por nova mensagem\n');
    } else {
      console.log('\n❌ Erro no webhook!');
      console.log('   Verifique se o endpoint está correto\n');
    }
  });
});

req.on('error', (e) => {
  console.error('\n❌ [ERROR]');
  console.error('   Erro ao conectar:', e.message);
  console.error('   Verifique se o servidor está rodando em localhost:3000\n');
});

console.log('\n⏳ Enviando...\n');
req.write(bodyString);
req.end();

// Aguardar um pouco para ver a resposta
setTimeout(() => {
  console.log('\n==========\n');
}, 5000);
