/**
 * Debug de FlowEngine - Verifica por que o bot não está respondendo
 */

const prisma = require('./src/services/database');
const FlowEngine = require('./src/services/FlowEngine');

async function debugFlowEngine() {
  try {
    console.log('\n========== 🤖 DEBUG FLOWENGINE ==========\n');

    // 1. Obter tenant
    const tenant = await prisma.tenant.findFirst({
      where: { name: 'TesteEmpresa' },
      include: { configuration: true }
    });

    if (!tenant) {
      console.error('❌ Tenant TesteEmpresa não encontrado');
      return;
    }

    console.log('✅ Tenant encontrado:', tenant.name);
    console.log('   ID:', tenant.id);

    // 2. Obter última conversa
    const contacts = await prisma.contact.findMany({
      where: { tenantId: tenant.id },
      select: { id: true }
    });

    const conversation = await prisma.conversation.findFirst({
      where: { 
        tenantId: tenant.id,
        contactId: { in: contacts.map(c => c.id) }
      },
      orderBy: { lastMessageAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 3 } }
    });

    if (!conversation) {
      console.error('❌ Nenhuma conversa encontrada');
      return;
    }

    console.log('\n✅ Conversa encontrada:');
    console.log('   ID:', conversation.id);
    console.log('   Status:', conversation.status);
    console.log('   FlowState:', JSON.stringify(conversation.flowState, null, 2));
    console.log('   Últimas mensagens:');
    conversation.messages.forEach((msg, idx) => {
      console.log(`      ${idx + 1}. [${msg.direction}] ${msg.contentType}: "${msg.content.substring(0, 50)}..."`);
    });

    // 3. Verificar se há flow configurado
    console.log('\n📋 Verificando flows configurados:');
    const flows = await prisma.flow.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, name: true, status: true }
    });

    if (flows.length === 0) {
      console.error('   ❌ PROBLEMA: Nenhum flow configurado!');
      console.error('   → O bot não tem fila de respostas');
      console.error('   → FlowEngine.process() não saberá o que fazer');
      return;
    }

    flows.forEach((flow) => {
      console.log(`   ✅ ${flow.name} (${flow.status})`);
    });

    // 4. Checar raiz do flow
    const firstFlow = flows[0];
    const flowConfig = await prisma.flow.findUnique({
      where: { id: firstFlow.id },
      select: { flowJson: true }
    });

    if (flowConfig?.flowJson) {
      console.log('\n📝 Estrutura do primeiro flow:');
      const flowData = typeof flowConfig.flowJson === 'string' 
        ? JSON.parse(flowConfig.flowJson) 
        : flowConfig.flowJson;
      console.log('   Root node:', flowData.rootNodeId || 'NÃO DEFINIDO');
      console.log('   Total nodes:', Object.keys(flowData.nodes || {}).length);
    }

    // 5. Verificar FlowState
    console.log('\n🔄 Estado atual da conversa no flow:');
    if (!conversation.flowState) {
      console.log('   ℹ️  Sem flowState - conversa aguardando primeiro input');
    } else {
      console.log('   nodeId:', conversation.flowState.nodeId || 'undefined');
      console.log('   dept:', conversation.flowState.dept || 'undefined');
      console.log('   waitingType:', conversation.flowState.waitingType || 'undefined');
    }

    console.log('\n========== RECOMENDAÇÕES ==========\n');
    
    if (flows.length === 0) {
      console.error('❌ CRÍTICO: Nenhum flow configurado!');
      console.error('   Ação: Crie um flow no dashboard ou execute:');
      console.error('   - POST /api/flows (criar flow)');
      console.error('   - Configure os nodes e regras\n');
    } else if (conversation.status === 'BOT') {
      console.log('ℹ️  Conversa em status BOT');
      console.log('   → Próxima mensagem deve desencadear FlowEngine.process()');
      console.log('   → Verifique logs de webhook\n');
    } else if (conversation.status === 'QUEUED') {
      console.log('ℹ️  Conversa em fila');
      console.log('   → Aguardando agent disponível');
      console.log('   → Verifique se há agentes online\n');
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

debugFlowEngine();
