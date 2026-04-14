const prisma = require('./src/services/database');

async function checkData() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║   DATABASE CHECK                          ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // Check tenants
  const tenants = await prisma.tenant.findMany();
  console.log(`Tenants: ${tenants.length}`);
  tenants.forEach((t) => console.log(`  - ${t.name} (${t.waPhoneId})`));

  // Check messages
  const messages = await prisma.message.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log(`\nMessages: ${messages.length}`);
  messages.forEach((m) => console.log(`  - "${m.content}" (${m.waId ? m.waId.substring(0, 30) : 'NULL'}...)`));

  // Check contacts 
  const contacts = await prisma.contact.findMany({ take: 5 });
  console.log(`\nContacts: ${contacts.length}`);
  contacts.forEach((c) => console.log(`  - ${c.name} (${c.phone})`));

  // Check conversations
  const conversations = await prisma.conversation.findMany({ take: 5 });
  console.log(`\nConversations: ${conversations.length}`);
  conversations.forEach((c) => console.log(`  - ${c.id.substring(0, 8)}... | Status: ${c.status}`));

  process.exit(0);
}

checkData().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
