const crypto = require('crypto');
const http = require('http');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runSimulation() {
  console.log('🚀 Iniciando Simulação de Webhook Interno...');

  // 1. Buscar tenant AmberTeste e sua configuração
  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'amberteste' },
    include: { configuration: true }
  });

  if (!tenant || !tenant.configuration) {
    console.error('❌ Erro: Tenant "amberteste" ou sua configuração não foram encontrados no banco.');
    process.exit(1);
  }

  const { id: tenantId } = tenant;
  const { phoneNumberId, metaAppSecret } = tenant.configuration;

  if (!metaAppSecret) {
    console.error('❌ Erro: metaAppSecret não está preenchido para este tenant.');
    process.exit(1);
  }

  console.log(`✅ Tenant Encontrado: ${tenant.name} (${tenantId})`);
  console.log(`✅ Phone Number ID: ${phoneNumberId}`);

  // 2. Construir o payload de mensagem idêntico ao do Meta
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '2169447660256643',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '554199999999',
                phone_number_id: phoneNumberId
              },
              contacts: [
                {
                  profile: { name: 'Simulador Teste' },
                  wa_id: '5511999999999'
                }
              ],
              messages: [
                {
                  from: '5511999999999',
                  id: 'wamid.Simulacao_' + Date.now(),
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: 'text',
                  text: { body: 'Oi, isso é um teste de simulação interna!' }
                }
              ]
            }
          }
        ]
      }
    ]
  };

  const bodyString = JSON.stringify(payload);

  // 3. Calcular a assinatura HMAC baseada no metaAppSecret do banco
  const hmac = crypto.createHmac('sha256', metaAppSecret).update(bodyString).digest('hex');
  const signatureHeader = `sha256=${hmac}`;

  console.log(`🔑 Assinatura Calculada: ${signatureHeader.substring(0, 30)}...`);

  // 4. Enviar a requisição HTTP POST para o endpoint local
  console.log('📡 Enviando requisição POST para o Express local...');
  
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: `/webhook/${tenantId}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signatureHeader,
      'X-Forwarded-Proto': 'https',
      'Content-Length': Buffer.byteLength(bodyString)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', async () => {
      console.log(`📥 Resposta do Servidor: HTTP ${res.statusCode}`);
      if (res.statusCode === 200) {
        console.log('✅ Webhook aceito pelo servidor local!');
        console.log('⏳ Aguardando 2 segundos para verificação no banco...');
        
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // 5. Verificar se a mensagem foi gravada no banco
        const message = await prisma.message.findFirst({
          where: { content: { contains: 'teste de simulação interna!' } },
          orderBy: { createdAt: 'desc' }
        });

        if (message) {
          console.log('🎉 SUCESSO ABSOLUTO! A mensagem foi gravada no banco de dados com sucesso:');
          console.log(`   - ID da Mensagem: ${message.id}`);
          console.log(`   - Conteúdo: "${message.content}"`);
          console.log(`   - Data: ${message.createdAt}`);
          console.log('\n👉 Verifique a tela de agente (/agent.html) agora, a mensagem deve estar lá!');
        } else {
          console.error('❌ Erro: O servidor retornou 200, mas a mensagem não foi encontrada no banco de dados.');
        }
      } else {
        console.error(`❌ Falha: O servidor rejeitou com status ${res.statusCode}.`);
        console.error(`   Detalhes: ${data}`);
      }
      process.exit(0);
    });
  });

  req.on('error', (err) => {
    console.error('❌ Erro na requisição HTTP:', err.message);
    process.exit(1);
  });

  req.write(bodyString);
  req.end();
}

runSimulation().catch((err) => {
  console.error('❌ Erro inesperado na simulação:', err);
  process.exit(1);
});
