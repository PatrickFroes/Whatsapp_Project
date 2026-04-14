const db = require('./src/services/database');

(async () => {
  try {
    console.log('\n=== VERIFICAÇÃO DO WEBHOOK DO PATRICK ===\n');

    // Procurar pelo ID da mensagem real
    const messageId = 'wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUNCQ0UxMDYyNDhERkM3MUQwRjNBMjFCQUM1MEE2REUA';
    const senderPhone = '554198613849';

    const message = await db.message.findFirst({
      where: { waId: messageId },
      include: {
        conversation: {
          include: {
            tenant: true,
            contact: true,
            assignedTo: true
          }
        }
      }
    });

    if (message) {
      console.log('✅ MENSAGEM ENCONTRADA NO BANCO!\n');
      console.log('📨 Mensagem:');
      console.log('   ID WhatsApp:', message.waId);
      console.log('   De:', message.fromUser);
      console.log('   Conteúdo:', message.content);
      console.log('   Status:', message.status);
      console.log('   Criada:', message.createdAt);

      const conv = message.conversation;
      console.log('\n📞 Conversa:');
      console.log('   ID:', conv.id);
      console.log('   Status:', conv.status);
      console.log('   Contato:', conv.contact?.name, '(' + conv.contact?.phone + ')');
      console.log('   Atribuído a:', conv.assignedTo?.name || 'Nenhum');
      console.log('   Bot State:', conv.flowState?.nodeId || 'N/A');
    } else {
      console.log('❌ MENSAGEM NÃO ENCONTRADA NO BANCO\n');
      
      // Verificar se tem alguma mensagem do Patrick
      const patrickMsgs = await db.message.findMany({
        where: { fromUser: senderPhone },
        include: { conversation: true }
      });
      
      console.log('Mensagens do Patrick encontradas:', patrickMsgs.length);
      patrickMsgs.forEach(m => {
        console.log('- waId:', m.waId);
        console.log('  Conteúdo:', m.content?.substring(0, 40));
        console.log('  Status:', m.status);
        console.log('');
      });
    }

    // Verificar logs recentes
    console.log('\n📋 ÚLTIMAS REQUISIÇÕES (verificar se webhook foi recebido):\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
})();
