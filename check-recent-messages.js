const db = require('./src/services/database');

(async () => {
  try {
    console.log('\n=== VERIFICAÇÃO DE MENSAGENS RECENTES ===\n');

    // Últimos 10 minutos
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const recentMessages = await db.message.findMany({
      where: {
        createdAt: { gte: tenMinutesAgo }
      },
      include: { conversation: { include: { tenant: true } } },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`📨 Mensagens dos últimos 10 minutos: ${recentMessages.length}\n`);
    
    if (recentMessages.length === 0) {
      console.log('❌ NENHUMA MENSAGEM RECEBIDA\n');
    } else {
      recentMessages.forEach((m, i) => {
        console.log(`${i+1}. De: ${m.fromUser || '(undefined)'}`);
        console.log(`   Conteúdo: ${m.content?.substring(0, 50) || 'N/A'}`);
        console.log(`   Status: ${m.status}`);
        console.log(`   Horário: ${m.createdAt}`);
        console.log('');
      });
    }

    // Verificar logs do webhook
    console.log('📋 LOGS DA APLICAÇÃO (últimos 20):');
    
    // Verificar conversas ativas
    const activeConversations = await db.conversation.findMany({
      where: { status: { in: ['BOT', 'QUEUED', 'ASSIGNED'] } },
      include: { contact: true, tenant: true }
    });

    console.log(`\n🗂️ Conversas ativas: ${activeConversations.length}`);
    activeConversations.forEach(c => {
      console.log(`   - ${c.contact?.name} (${c.contact?.phone}): ${c.status}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
})();
