#!/usr/bin/env node

const prisma = require('./src/services/database');

async function main() {
  try {
    console.log('\n📋 VERIFICANDO SE MENSAGEM FOI SALVA...\n');

    // Buscar últimas mensagens
    const messages = await prisma.message.findMany({
      take: -10, // Últimas 10
      orderBy: { createdAt: 'desc' },
      include: {
        conversation: {
          include: { tenant: true }
        }
      }
    });

    console.log(`Total de mensagens encontradas: ${messages.length}\n`);

    if (messages.length === 0) {
      console.log('❌ Nenhuma mensagem encontrada\n');
      process.exit(0);
    }

    messages.forEach((msg, i) => {
      console.log(`${i + 1}. Mensagem`);
      console.log(`   ID: ${msg.id}`);
      console.log(`   Tenant: ${msg.conversation?.tenant?.name || 'desconhecido'}`);
      console.log(`   From: ${msg.fromUser}`);
      console.log(`   Body: ${msg.body?.substring(0, 50) || 'N/A'}...`);
      console.log(`   Status: ${msg.status}`);
      console.log(`   Criada em: ${msg.createdAt}`);
      console.log('');
    });

    // Verificar especificamente pelo texto do teste
    const testMsg = messages.find(m => m.body?.includes('Teste webhook POST'));
    if (testMsg) {
      console.log('✅ MENSAGEM DE TESTE FOI SALVA!\n');
      console.log('Detalhes:');
      console.log(JSON.stringify(testMsg, null, 2));
    } else {
      console.log('⚠️  Mensagem de teste NÃO encontrada\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

main();
