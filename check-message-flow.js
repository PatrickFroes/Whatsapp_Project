/**
 * Verificar fluxo de mensagens e diagnóstico
 */
const prisma = require('./src/services/database');

async function checkFlow() {
  try {
    console.log('\n========== 📊 CHECK MESSAGE FLOW ==========\n');

    const tenant = await prisma.tenant.findFirst({
      where: { name: 'TesteEmpresa' }
    });

    if (!tenant) {
      console.error('❌ Tenant não encontrado');
      return;
    }

    // Contar conversas por status
    const statuses = ['BOT', 'QUEUED', 'ASSIGNED', 'RESOLVED', 'CLOSED'];
    console.log('📊 Conversas por status:');
    for (const status of statuses) {
      const count = await prisma.conversation.count({
        where: { tenantId: tenant.id, status }
      });
      console.log(`   ${status}: ${count}`);
    }

    // Mensagens mais recentes
    const messages = await prisma.message.findMany({
      where: {
        conversation: { tenantId: tenant.id }
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { conversation: true }
    });

    console.log('\n📨 5 últimas mensagens:');
    messages.forEach((msg, i) => {
      console.log(`   ${i+1}. [${msg.direction}] (${msg.conversation.status}) "${msg.content.substring(0, 30)}..."`);
      console.log(`      Criada: ${msg.createdAt.toISOString().substring(11, 19)}`);
    });

    // Verificar se há webhook logs
    console.log('\n🔔 Verificando webhook logs nos últimos minutos...');
    const recentConvs = await prisma.conversation.findMany({
      where: { tenantId: tenant.id },
      orderBy: { lastMessageAt: 'desc' },
      take: 1
    });

    if (recentConvs.length > 0) {
      const lastUpdate = new Date(recentConvs[0].lastMessageAt);
      const now = new Date();
      const diffSeconds = (now - lastUpdate) / 1000;
      
      if (diffSeconds < 60) {
        console.log(`   ✅ Webhook recebido há ${diffSeconds.toFixed(0)} segundos`);
      } else {
        console.log(`   ⚠️  Último webhook há ${Math.floor(diffSeconds / 60)} minutos`);
      }
    }

    // Verificar container's nginx/reverse proxy
    console.log('\n🔐 DIAGNÓSTICO DE WEBHOOK:');
    console.log('   1. Verificar se ngrok/tunél está ativo');
    console.log('   2. Confirmar que Meta tem URL correta apontando para https://seu-dominio.com/webhook/whatsapp');
    console.log('   3. Ver logs: docker logs broker_app');
    console.log('   4. Se webhook não chega, verificar:');
    console.log('      - Webhook URL no Meta App Dashboard');
    console.log('      - Webhook token (verify token)');
    console.log('      - App Secret (HMAC validation)');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkFlow();
