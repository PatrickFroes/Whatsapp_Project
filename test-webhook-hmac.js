const crypto = require('crypto');
const https = require('https');

const APP_SECRET = '5f15f81a7f3a8d4eb53a01920d60b959';
const WEBHOOK_URL = 'https://broker.amber.com.br/webhook';

const payload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: '100000000',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '5511999999999',
          phone_number_id: '946528235219456'
        },
        messages: [{
          from: '5511999999999',
          id: 'wamid.test' + Date.now(),
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: 'Teste webhook POST - ' + new Date().toLocaleTimeString() }
        }]
      },
      field: 'messages'
    }]
  }]
});

const signature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex');

console.log('🧪 Testando POST com HMAC válido');
console.log('URL:', WEBHOOK_URL);
console.log('Signature:', signature);
console.log('Payload:', JSON.parse(payload));
console.log('\n⏳ Enviando...\n');

const url = new URL(WEBHOOK_URL);
const options = {
  hostname: url.hostname,
  port: url.port || 443,
  path: url.pathname,
  method: 'POST',
  headers: {
    'x-hub-signature-256': signature,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  },
  rejectUnauthorized: false // Para ignorar certificado auto-assinado
};

const req = https.request(options, (res) => {
  console.log('✅ Status:', res.statusCode);
  console.log('Headers:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', data || '(empty body)');
    
    // Agora verifica se mensagem foi salva
    setTimeout(checkDatabase, 1000);
  });
});

req.on('error', (error) => {
  console.error('❌ Erro ao enviar:', error.message);
  process.exit(1);
});

req.write(payload);
req.end();

// Função para verificar se mensagem foi salva no banco
function checkDatabase() {
  console.log('\n📊 Verificando se mensagem foi salva no banco...');
  
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  
  (async () => {
    try {
      // Buscar última mensagem
      const lastMessage = await prisma.Message.findFirst({
        where: {
          text: { contains: 'Teste webhook POST' }
        },
        orderBy: { createdAt: 'desc' }
      });
      
      if (lastMessage) {
        console.log('✅ Mensagem ENCONTRADA no banco:');
        console.log('  - ID:', lastMessage.id);
        console.log('  - Texto:', lastMessage.text);
        console.log('  - Status:', lastMessage.status);
        console.log('  - Criada em:', lastMessage.createdAt);
        console.log('  - Tenant ID:', lastMessage.tenantId);
      } else {
        console.log('❌ Mensagem NÃO foi salva no banco');
        
        // Debug: mostrar últimas mensagens
        const recent = await prisma.Message.findMany({
          orderBy: { createdAt: 'desc' },
          take: 3
        });
        console.log('\n📌 Últimas 3 mensagens:');
        recent.forEach(msg => {
          console.log('  -', msg.text, '|', msg.status, '|', msg.createdAt);
        });
      }
      
      // Verificar conversas ativas
      const conversations = await prisma.Conversation.findMany({
        where: { status: { not: 'RESOLVED' } },
        take: 5
      });
      
      console.log('\n💬 Conversas ativas:', conversations.length);
      conversations.forEach(conv => {
        console.log('  - Status:', conv.status, '| Tenant:', conv.tenantId);
      });
      
    } catch (error) {
      console.error('❌ Erro ao verificar DB:', error.message);
    } finally {
      await prisma.$disconnect();
      process.exit(0);
    }
  })();
}
