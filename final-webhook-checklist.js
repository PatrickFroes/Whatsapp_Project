// final-webhook-checklist.js
// Checklist final antes de usar aba de teste do Meta

const https = require('https');
const { PrismaClient } = require('@prisma/client');

const WEBHOOK_URL = 'https://broker.amber.com.br/webhook';
const VERIFY_TOKEN = 'minha_senha_segura_webhook';

const p = new PrismaClient();

async function runChecklist() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  WEBHOOK READINESS CHECKLIST          ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Check 1: Verificar endpoint GET
    console.log('📝 [CHECK 1] Testando GET /webhook (Meta verification)...');
    await new Promise((resolve) => {
      https.get(`${WEBHOOK_URL}?hub.mode=subscribe&hub.challenge=final_test&hub.verify_token=${VERIFY_TOKEN}`, (res) => {
        if (res.statusCode === 200) {
          console.log('✅ GET /webhook respondendo 200 OK\n');
        } else {
          console.log(`❌ GET /webhook retornou ${res.statusCode}\n`);
        }
        resolve();
      }).on('error', (e) => {
        console.log(`❌ Erro: ${e.message}\n`);
        resolve();
      });
    });

    // Check 2: Verificar Configuration
    console.log('📝 [CHECK 2] Verificando Configuration no banco...');
    const config = await p.configuration.findFirst();
    if (config && config.metaAppSecret && config.phoneNumberId) {
      console.log(`✅ Configuration completa:`);
      console.log(`   - phoneNumberId: ${config.phoneNumberId}`);
      console.log(`   - metaAppSecret: ${config.metaAppSecret.substring(0, 10)}...`);
      console.log(`   - verifyToken: ${config.verifyToken ? '✅' : '❌'}`);
      console.log(`   - whatsappToken: ${config.whatsappToken ? '✅' : '❌'}\n`);
    } else {
      console.log('❌ Configuration incompleta\n');
    }

    // Check 3: Verificar Tenant
    console.log('📝 [CHECK 3] Verificando Tenant.waPhoneId sincronizado...');
    const tenant = await p.tenant.findFirst({
      where: { waPhoneId: { not: null } }
    });
    if (tenant && tenant.waPhoneId) {
      console.log(`✅ Tenant sincronizado:`);
      console.log(`   - Nome: ${tenant.name}`);
      console.log(`   - waPhoneId: ${tenant.waPhoneId}\n`);
    } else {
      console.log('❌ Nenhum Tenant com waPhoneId\n');
    }

    // Check 4: Resumo final
    console.log('╔════════════════════════════════════════╗');
    console.log('║  STATUS FINAL                         ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    if (config && tenant && config.metaAppSecret) {
      console.log('✅ WEBHOOK PRONTO PARA RECEBER MENSAGENS!\n');
      console.log('Próximos passos:');
      console.log('1. Abra: https://developers.facebook.com/apps/');
      console.log('2. Selecione seu app');
      console.log('3. Vá para: Produtos → WhatsApp Business → Teste');
      console.log('4. Na seção "Webhook de teste", clique "Enviar mensagem de teste"');
      console.log('5. Escolha "messages" como campo');
      console.log('6. Clique "Enviar"');
      console.log('7. Execute: docker compose exec -T broker_app node /app/verify-webhook-messages.js');
      console.log('   para verificar se a mensagem foi salva\n');
    } else {
      console.log('❌ Webhook NOT READY - Faltam configurações\n');
    }

  } catch (error) {
    console.error('Erro:', error.message);
  } finally {
    await p.$disconnect();
  }
}

runChecklist();
