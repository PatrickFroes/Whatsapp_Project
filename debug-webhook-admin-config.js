// debug-webhook-admin-config.js
// Verifica se as configurações da aba admin estão corretas e ativas

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const p = new PrismaClient();

async function debugWebhookConfig() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  DEBUG: CONFIGURAÇÕES DE WEBHOOK DO ADMIN          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    // 1. Buscar TODAS as configurações
    console.log('📝 [ETAPA 1] Buscando configurações no banco...\n');
    const allConfigs = await p.configuration.findMany({
      include: {
        tenant: {
          select: { id: true, name: true, slug: true, waPhoneId: true }
        }
      }
    });

    if (allConfigs.length === 0) {
      console.log('❌ NENHUMA configuração encontrada no banco!\n');
      console.log('Solução:');
      console.log('1. Acesse o painel admin em: https://broker.amber.com.br/admin.html');
      console.log('2. Faça login com super@amber.com / Test1234');
      console.log('3. Clique em "Tenants" → Selecione seu tenant');
      console.log('4. Vá em "Configuração" e preencha:');
      console.log('   - Phone Number ID: Seu ID do WhatsApp Business');
      console.log('   - Meta App Secret: De https://developers.facebook.com/apps/');
      console.log('   - Verify Token: minha_senha_segura_webhook');
      console.log('   - WhatsApp Token: Seu token de acesso do Meta');
      console.log('5. Clique "Salvar"\n');
      await p.$disconnect();
      return;
    }

    console.log(`✅ Encontradas ${allConfigs.length} configuração(ões):\n`);

    allConfigs.forEach((config, idx) => {
      console.log(`[CONFIG ${idx + 1}]`);
      console.log(`  Tenant: ${config.tenant.name} (${config.tenant.slug})`);
      console.log(`  Tenant ID: ${config.tenant.id}`);
      console.log(`  Tenant.waPhoneId: ${config.tenant.waPhoneId || '❌ NULL'}`);
      console.log(`  Config.phoneNumberId: ${config.phoneNumberId || '❌ NULL'}`);
      
      const hasSecret = !!config.metaAppSecret;
      const hasVerify = !!config.verifyToken;
      const hasToken = !!config.whatsappToken;
      
      console.log(`  Campos preenchidos:`);
      console.log(`    - metaAppSecret: ${hasSecret ? '✅' : '❌'}`);
      console.log(`    - verifyToken: ${hasVerify ? '✅' : '❌'}`);
      console.log(`    - whatsappToken: ${hasToken ? '✅' : '❌'}`);
      console.log(`  Atualizado em: ${new Date(config.updatedAt).toLocaleString('pt-BR')}`);
      
      if (hasSecret && hasVerify && hasToken && config.phoneNumberId && config.tenant.waPhoneId) {
        console.log(`  ✅ ESTA CONFIGURAÇÃO ESTÁ COMPLETA E PRONTA`);
      } else {
        console.log(`  ❌ ESTA CONFIGURAÇÃO ESTÁ INCOMPLETA`);
      }
      console.log('');
    });

    // 2. Testar HMAC com a primeira configuração
    console.log('📝 [ETAPA 2] Testando validação HMAC...\n');
    
    const config = allConfigs[0];
    if (!config.metaAppSecret) {
      console.log('❌ Sem metaAppSecret, não posso testar HMAC\n');
      await p.$disconnect();
      return;
    }

    const testPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '12345',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '558412345678',
              phone_number_id: config.phoneNumberId,
              webhook_id: 'webhook_id'
            },
            messages: [{
              from: '558498765432',
              id: 'wamid.test',
              timestamp: '1234567890',
              type: 'text',
              text: { body: 'Test' }
            }]
          }
        }]
      }]
    };

    const rawBody = JSON.stringify(testPayload);
    const hmac = crypto
      .createHmac('sha256', config.metaAppSecret)
      .update(rawBody)
      .digest('hex');
    const expectedSignature = `sha256=${hmac}`;

    console.log(`Secret (primeiros 20 chars): ${config.metaAppSecret.substring(0, 20)}...`);
    console.log(`HMAC esperado: ${expectedSignature}\n`);
    console.log(`Quando Meta enviar um webhook, ele deve incluir um header:`);
    console.log(`X-Hub-Signature-256: ${expectedSignature}`);
    console.log(`(ou similar, calculado com o mesmo secret)\n`);

    // 3. Instruções finais
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  CHECKLIST FINAL                                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    const isConfigComplete = config.metaAppSecret && config.verifyToken && 
                            config.whatsappToken && config.phoneNumberId &&
                            config.tenant.waPhoneId;

    if (isConfigComplete) {
      console.log('✅ Todas as configurações estão corretas!\n');
      console.log('Se ainda não recebe webhooks do Meta, verifique:');
      console.log('');
      console.log('1. Se o certificado SSL é válido:');
      console.log('   curl -v https://broker.amber.com.br/webhook?hub.mode=subscribe&hub.challenge=test&hub.verify_token=minha_senha_segura_webhook');
      console.log('');
      console.log('2. Se o firewall permite requisições do Meta:');
      console.log('   IPs do Meta: 31.13.64.0/18, 31.13.128.0/17, 31.13.192.0/18');
      console.log('');
      console.log('3. Monitore os logs em tempo real:');
      console.log('   docker compose logs -f broker_app | grep -iE "(webhook|POST|HMAC|error)"');
      console.log('');
      console.log('4. Teste enviando um webhook via Meta:');
      console.log('   https://developers.facebook.com/apps/ → Sua App → WhatsApp → Teste');
      console.log('');
    } else {
      console.log('❌ CONFIGURAÇÃO INCOMPLETA!\n');
      console.log('Campos faltando:');
      if (!config.metaAppSecret) console.log('  - metaAppSecret');
      if (!config.verifyToken) console.log('  - verifyToken');
      if (!config.whatsappToken) console.log('  - whatsappToken');
      if (!config.phoneNumberId) console.log('  - phoneNumberId');
      if (!config.tenant.waPhoneId) console.log('  - Tenant.waPhoneId (verifique se sincronizou)');
      console.log('');
      console.log('Preencha no painel admin: https://broker.amber.com.br/admin.html\n');
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await p.$disconnect();
  }
}

debugWebhookConfig();
