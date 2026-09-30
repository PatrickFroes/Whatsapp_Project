require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { enqueueConversation } = require('../src/queues/aiQueue');

async function runTest() {
  console.log('🤖 [AI Test] Inicializando teste do Worker de IA...');
  
  try {
    // 1. Obter ou criar um Tenant de teste
    let tenant = await prisma.tenant.findFirst({
      where: { slug: 'ai-test-tenant' }
    });

    if (!tenant) {
      console.log('🤖 [AI Test] Criando tenant temporário para testes...');
      tenant = await prisma.tenant.create({
        data: {
          name: 'AI Test Tenant',
          slug: 'ai-test-tenant',
          plan: 'ENTERPRISE',
          featureAiSummary: true
        }
      });
    } else {
      // Garantir que a flag de IA está ativada no tenant
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { featureAiSummary: true }
      });
    }

    // 2. Criar um contato de teste
    let contact = await prisma.contact.findFirst({
      where: { phone: '5511999999999', tenantId: tenant.id }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          phone: '5511999999999',
          name: 'Cliente Teste IA',
          tenantId: tenant.id
        }
      });
    }

    // 3. Criar uma conversa de teste
    console.log('🤖 [AI Test] Criando conversa e histórico fictício...');
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        status: 'RESOLVED',
        disposition: 'Teste de IA',
        closingNotes: 'Mensagens geradas automaticamente'
      }
    });

    // 4. Criar histórico de mensagens fictício
    const sampleMessages = [
      { content: 'Olá, gostaria de entender a cobrança da minha fatura de julho. Veio um valor acima do normal.', direction: 'INBOUND' },
      { content: 'Olá! Deixe-me verificar para você. Identifiquei que houve uma contratação adicional de licença no dia 10 de junho, o que gerou o proporcional nesta fatura.', direction: 'OUTBOUND' },
      { content: 'Ah, entendi! Verdade, eu ativei um novo agente naquele período. Obrigado pela explicação clara e pelo ótimo atendimento rápido!', direction: 'INBOUND' },
      { content: 'Por nada! Ficamos muito felizes em ajudar. Desejo um excelente dia!', direction: 'OUTBOUND' }
    ];

    for (let i = 0; i < sampleMessages.length; i++) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content: sampleMessages[i].content,
          direction: sampleMessages[i].direction,
          createdAt: new Date(Date.now() + i * 1000)
        }
      });
    }

    console.log(`🤖 [AI Test] Histórico criado com sucesso. ID da conversa: ${conversation.id}`);
    console.log('🤖 [AI Test] Variáveis de ambiente configuradas para o teste:');
    console.log(`   - AI_PROVIDER: ${process.env.AI_PROVIDER || 'ollama'}`);
    console.log(`   - AI_ENDPOINT: ${process.env.AI_ENDPOINT || 'http://localhost:11434'}`);
    console.log(`   - AI_MODEL: ${process.env.AI_MODEL || 'qwen2.5:3b'}`);

    console.log('\n🤖 [AI Test] Adicionando conversa na fila de processamento...');
    enqueueConversation(conversation.id);

    console.log('🤖 [AI Test] Aguardando o processamento assíncrono terminar...');
    
    let resultConv = null;
    const maxAttempts = 30; // 30 tentativas * 2 segundos = 60 segundos limite
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      resultConv = await prisma.conversation.findUnique({
        where: { id: conversation.id }
      });
      
      if (resultConv && resultConv.aiSentiment !== null) {
        console.log(`🤖 [AI Test] Processamento concluído com sucesso em ~${attempt * 2} segundos!`);
        break;
      }
      
      console.log(`   - Aguardando resposta da IA (tentativa ${attempt}/${maxAttempts})...`);
    }

    if (!resultConv || resultConv.aiSentiment === null) {
      console.log('❌ [AI Test] Timeout: A IA não respondeu a tempo.');
      // Carregar objeto básico para não quebrar a impressão
      resultConv = { aiSentiment: 'TIMEOUT', aiSummary: 'A IA excedeu o tempo limite do teste.', aiTags: [] };
    }

    console.log('\n======================================================');
    console.log('🤖 [AI Test] RESULTADO DO PROCESSAMENTO DA IA:');
    console.log('======================================================');
    console.log(`Sentimento: ${resultConv.aiSentiment || 'NÃO PROCESSADO'}`);
    console.log(`Resumo: ${resultConv.aiSummary || 'NÃO PROCESSADO'}`);
    console.log(`Tags: ${JSON.stringify(resultConv.aiTags || [])}`);
    console.log('======================================================');

    // 6. Limpeza do banco de dados
    console.log('\n🤖 [AI Test] Limpando dados de teste do banco...');
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversation.delete({ where: { id: conversation.id } });
    
    // Opcional: manter tenant e contato de teste para reuso
    console.log('🤖 [AI Test] Limpeza concluída com sucesso!');
    console.log('🤖 [AI Test] Teste finalizado.');

  } catch (err) {
    console.error('❌ [AI Test] Falha ao executar o script de teste:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
