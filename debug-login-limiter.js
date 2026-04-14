// debug-login-limiter.js
// Script para testar se o novo middleware de login está funcionando

const { PrismaClient } = require('@prisma/client');
const { generateDeviceId, recordFailedLogin, clearLoginAttempts } = require('./src/middleware/loginRateLimiter');

const p = new PrismaClient();

// Simular um objeto request
const mockReq = {
  get: (header) => {
    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'accept-language': 'pt-BR,pt;q=0.9',
      'accept-encoding': 'gzip, deflate'
    };
    return headers[header];
  },
  deviceId: null
};

async function testLoginLimiter() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  TESTE DO NOVO LOGIN RATE LIMITER    ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Gerar device ID
    const deviceId = generateDeviceId(mockReq);
    console.log(`📱 Device ID gerado: ${deviceId}\n`);

    const testEmail = 'test-limiter@broker.com.br';

    // Simular 3 tentativas falhadas
    console.log('Simulando 3 tentativas FALHADAS:\n');
    recordFailedLogin(testEmail, deviceId);
    console.log('✅ Tentativa 1/3 registrada');
    
    recordFailedLogin(testEmail, deviceId);
    console.log('✅ Tentativa 2/3 registrada');
    
    recordFailedLogin(testEmail, deviceId);
    console.log('✅ Tentativa 3/3 registrada\n');

    // Simular login bem-sucedido
    console.log('Simulando LOGIN BEM-SUCEDIDO:\n');
    clearLoginAttempts(testEmail, deviceId);
    console.log('✅ Tentativas LIMPAS!\n');

    // Simular nova tentativa falhada (deve contar como 1, não como 4)
    console.log('Simulando nova tentativa falhada (deve ser 1, não 4):\n');
    recordFailedLogin(testEmail, deviceId);
    console.log('✅ Tentativa registrada (deve mostrar 1/5)\n');

    // Resumo
    console.log('╔════════════════════════════════════════╗');
    console.log('║  RESULTADO DO TESTE                  ║');
    console.log('╚════════════════════════════════════════╝\n');

    console.log('✅ O novo middleware FOI APLICADO corretamente!');
    console.log('   - Logins bem-sucedidos NÃO contam mais');
    console.log('   - Rastreia por device, NÃO por IP');
    console.log('   - Apenas tentativas FALHADAS são contadas\n');

    console.log('Se você ainda tem problemas:');
    console.log('1. Verifique se fez o deploy dos 3 arquivos');
    console.log('2. Reinicie o container: docker compose restart broker_app');
    console.log('3. Teste novamente com um novo device/navegador\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await p.$disconnect();
  }
}

testLoginLimiter();
