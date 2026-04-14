// test-login-attempts-debug.js
// Teste para ver o estado atual das tentativas

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugCurrentState() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  DEBUG: TESTANDO STATUS DAS TENTATIVAS DE LOGIN      ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Listar todos os usuários
    const users = await prisma.user.findMany({
      select: { email: true, role: true, tenantId: true }
    });

    if (users.length === 0) {
      console.log('❌ Nenhum usuário encontrado');
      await prisma.$disconnect();
      return;
    }

    console.log('✅ Usuários no sistema:\n');
    users.forEach(u => console.log(`   - ${u.email} (${u.role})`));

    console.log('\n📝 Para testar o novo rate limiter:\n');

    console.log('1. Tente fazer login 5 vezes com a SENHA ERRADA consecutivamente');
    console.log('   URL: https://broker.amber.com.br/admin.html');
    console.log('   (você deve ser bloqueado na 6ª tentativa)');

    console.log('\n2. Depois de ser bloqueado, faça um LOGIN BEM-SUCEDIDO');
    console.log('   As tentativas devem ser LIMPAS');

    console.log('\n3. Tente novamente com senha errada');
    console.log('   Deve contar como 1, não como 6');

    console.log('\n📊 Verificando logs:\n');

    console.log('Execute no servidor para ver logs em tempo real:');
    console.log('docker compose logs -f broker_app | grep -iE "(LOGIN|tentativa|blocked)"');

    console.log('\n⚠️  PROBLEMAS POSSÍVEIS:\n');

    console.log('Se ainda contar logins bem-sucedidos:');
    console.log('1. Verifique se está fazendo login com o MESMO device/navegador');
    console.log('2. Limpe o cache do navegador (Ctrl+Shift+Delete)');
    console.log('3. Feche TODAS as abas');
    console.log('4. Tente em Navegação Privada/Anônimo');
    console.log('5. Verifique se há VPN/Proxy ativo\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

debugCurrentState();
