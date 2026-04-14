const prisma = require('./src/services/database');

(async () => {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, waPhoneId: true }
  });

  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║          AVAILABLE TENANTS                ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  tenants.forEach((t, idx) => {
    console.log(`${idx + 1}. Name: ${t.name}`);
    console.log(`   ID: ${t.id}`);
    console.log(`   waPhoneId: ${t.waPhoneId || '(not set)'}`);
    console.log('');
  });

  console.log(`Total: ${tenants.length} tenants\n`);
  process.exit(0);
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
