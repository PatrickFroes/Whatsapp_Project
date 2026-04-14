const db = require('./src/services/database');

(async () => {
  try {
    console.log('\n📋 ANÁLISE DETALHADA DA MENSAGEM DE TESTE\n');
    
    // Buscar a mensagem de teste
    const msg = await db.message.findFirst({
      where: { content: { contains: 'Teste webhook' } },
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
    
    if (!msg) {
      console.log('❌ Mensagem não encontrada');
      process.exit(0);
    }
    
    console.log('✅ Mensagem encontrada:\n');
    console.log('ID:', msg.id);
    console.log('Conteúdo:', msg.content);
    console.log('Status:', msg.status);
    console.log('De:', msg.fromUser);
    console.log('waId:', msg.waId);
    console.log('Criada em:', msg.createdAt);
    
    console.log('\n📞 CONVERSA:\n');
    const conv = msg.conversation;
    console.log('ID:', conv.id);
    console.log('Tenant:', conv.tenant?.name);
    console.log('Contato:', conv.contact?.name || conv.contact?.phone || conv.contact?.waPhoneId);
    console.log('Status:', conv.status);
    console.log('Modo:', conv.mode);
    console.log('Atribuído a:', conv.assignedTo?.name || 'Nenhum agente');
    console.log('CreatedAt:', conv.createdAt);
    
    console.log('\n🤖 BOT/FLOW:\n');
    console.log('flowState:', conv.flowState);
    console.log('currentFlowStateId:', conv.currentFlowStateId);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
