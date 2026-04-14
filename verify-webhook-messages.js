// verify-webhook-messages.js
// Verifica se as mensagens do webhook foram salvas no banco

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function verify() {
  try {
    console.log('\n=== VERIFICAÇÃO DE MENSAGENS WEBHOOK ===\n');

    // Buscar todas as conversar da última 24h
    const conversations = await p.conversation.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (conversations.length === 0) {
      console.log('❌ Nenhuma conversa criada nas últimas 24h');
      console.log('\nIsso pode significar:');
      console.log('- Nenhuma mensagem chegou via webhook ainda');
      console.log('- Ou as mensagens não foram processadas');
      await p.$disconnect();
      return;
    }

    console.log(`✅ Encontradas ${conversations.length} conversa(s):\n`);

    conversations.forEach((conv, idx) => {
      console.log(`[${idx + 1}] Conversa: ${conv.waConversationId || conv.id}`);
      console.log(`    Contato: ${conv.contactName || 'N/A'} (${conv.contactPhone})`);
      console.log(`    Status: ${conv.status}`);
      console.log(`    Total de mensagens: ${conv.messages.length}`);
      
      if (conv.messages.length > 0) {
        console.log(`    Última mensagem: ${conv.messages[0].text?.substring(0, 50) || conv.messages[0].type}...`);
        console.log(`    Timestamp: ${new Date(conv.messages[0].createdAt).toLocaleString('pt-BR')}`);
      }
      console.log('');
    });

    console.log('\n=== TOTAL DE MENSAGENS ===\n');
    const totalMessages = await p.message.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      }
    });

    console.log(`Total: ${totalMessages} mensagens nas últimas 24h`);

    if (totalMessages === 0) {
      console.log('\n⚠️  Nenhuma mensagem foi salva ainda.');
      console.log('\nNa aba de teste do Meta, clique em "Send Test Webhook"');
      console.log('para enviar uma mensagem de teste para seu webhook.');
    } else {
      console.log('\n✅ Webhooks estão sendo processados corretamente!');
    }

    await p.$disconnect();
  } catch (error) {
    console.error('Erro:', error.message);
    await p.$disconnect();
  }
}

verify();
