const db = require('./src/services/database');

(async () => {
  try {
    const msg = await db.message.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { conversation: true }
    });
    
    console.log('\n📨 ÚLTIMA MENSAGEM:');
    console.log('Conteúdo:', msg?.content);
    console.log('De (fromUser):', msg?.fromUser);
    console.log('Status:', msg?.status);
    console.log('SenderId:', msg?.senderId);
    console.log('Criada:', msg?.createdAt);
    process.exit(0);
  } catch(e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
})();
