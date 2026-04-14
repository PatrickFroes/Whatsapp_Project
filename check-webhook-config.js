const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p.configuration.findFirst().then(c => {
  if (!c) {
    console.log('❌ Nenhuma Configuration encontrada');
    p.$disconnect();
    return;
  }
  console.log('\n=== WEBHOOK CONFIG ===\n');
  console.log('Phone Number ID:', c.phoneNumberId || '❌ Faltando');
  console.log('Verify Token:', c.verifyToken ? '✅ Configurado' : '❌ Faltando');
  console.log('Meta App Secret:', c.metaAppSecret ? '✅ Configurado' : '❌ Faltando');
  console.log('WhatsApp Token:', c.whatsappToken ? '✅ Configurado' : '❌ Faltando');
  console.log('');
  p.$disconnect();
}).catch(e => console.error('Erro:', e.message));
