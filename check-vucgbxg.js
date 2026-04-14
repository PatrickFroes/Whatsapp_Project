const db = require('./src/services/database');

(async () => {
  try {
    console.log('\n=== VERIFICAÇÃO PATRICK (SIMPLES) ===\n');

    // Procurar qualquer mensagem com "Vucgbxg" (conteúdo da mensagem)
    const messages = await db.message.findMany({
      where: { content: { contains: 'Vucgbxg' } },
      include: {
        conversation: {
          include: { contact: true, tenant: true }
        }
      }
    });

    if (messages.length > 0) {
      console.log('✅ MENSAGEM ENCONTRADA!\n');
      const msg = messages[0];
      console.log('Conteúdo:', msg.content);
      console.log('De (senderId):', msg.senderId);
      console.log('Status:', msg.status);
      console.log('Direction:', msg.direction);
      console.log('waId:', msg.waId);
      console.log('Criada:', msg.createdAt);
      console.log('\nConversa:');
      console.log('Status:', msg.conversation?.status);
      console.log('Contato: ', msg.conversation?.contact?.name);
      console.log('Tenant:', msg.conversation?.tenant?.name);
    } else {
      console.log('❌ MENSAGEM COM "Vucgbxg" NÃO ENCONTRADA\n');
      
      // Listar últimas mensagens
      const recent = await db.message.findMany({take: -3, orderBy: {createdAt: 'desc'}});
      console.log('Últimas 3 mensagens:');
      recent.forEach(m => console.log('- ' + m.content?.substring(0,30) + ' | ' + m.createdAt));
    }

    process.exit(0);
  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  }
})();
