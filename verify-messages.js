const db = require('./src/services/database');

(async () => {
  try {
    console.log('\n📋 VERIFICANDO MENSAGENS...\n');
    
    // Procurar mensagens de teste
    const testMsgs = await db.message.findMany({
      where: { content: { contains: 'Teste webhook' } },
      take: 5,
      include: { conversation: { include: { tenant: true } } }
    });
    
    console.log('✅ Mensagens com "Teste webhook":', testMsgs.length);
    if (testMsgs.length > 0) {
      testMsgs.forEach(m => {
        console.log('   - De:', m.fromUser, '| Status:', m.status, '| Criada:', m.createdAt);
      });
    }
    
    // Últimas 5 mensagens
    const recent = await db.message.findMany({
      take: -5,
      orderBy: { createdAt: 'desc' },
      include: { conversation: { include: { tenant: true } } }
    });
    
    console.log('\n📬 Últimas 5 mensagens:');
    recent.forEach((m, i) => {
      console.log(`${i+1}. De: ${m.fromUser} | Status: ${m.status} | ${m.content?.substring(0,35) || 'N/A'}... | ${m.createdAt}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
})();
