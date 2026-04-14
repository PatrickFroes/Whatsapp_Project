// monitor-webhook-logs.js
// Script para monitorar logs e capturar requisições no webhook

const { spawn } = require('child_process');

console.log('\n╔════════════════════════════════════════╗');
console.log('║  MONITORANDO WEBHOOK EM TEMPO REAL    ║');
console.log('╚════════════════════════════════════════╝\n');

console.log('📡 Aguardando requisições no webhook...\n');
console.log('Instruções para testar:');
console.log('1. Abra: https://developers.facebook.com/apps/');
console.log('2. Selecione seu app WhatsApp');
console.log('3. Vá para: Produtos → WhatsApp → Teste');
console.log('4. Na seção "Webhook", clique "Enviar mensagem de teste"');
console.log('5. Escolha "messages" e "status" como campos');
console.log('6. Clique "Enviar"');
console.log('\n🔍 Logs em tempo real:\n');

// Monitorar logs do container
const logs = spawn('docker', ['compose', 'logs', '-f', 'broker_app'], {
  stdio: 'pipe',
  shell: true
});

let webhookRequestsFound = 0;

logs.stdout.on('data', (data) => {
  const output = data.toString();
  
  // Procurar por webhooks
  if (output.includes('webhook') || output.includes('POST /webhook') || output.includes('HMAC')) {
    webhookRequestsFound++;
    console.log(output);
  }
  
  // Procurar por erros
  if (output.includes('ERROR') || output.includes('error') || output.includes('Failed')) {
    console.log(output);
  }
});

logs.stderr.on('data', (data) => {
  console.log(`ERRO: ${data}`);
});

logs.on('close', (code) => {
  console.log(`\nMonitoramento encerrado (código: ${code})`);
});

// Permitir Ctrl+C para sair
process.on('SIGINT', () => {
  console.log('\n\n╔════════════════════════════════════════╗');
  console.log('║  MONITORAMENTO ENCERRADO             ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log(`Total de requisições webhook detectadas: ${webhookRequestsFound}\n`);
  process.exit(0);
});
