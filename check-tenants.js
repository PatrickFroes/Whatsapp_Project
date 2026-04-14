const prisma = require('./src/services/database');

async function checkTenants() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, waPhoneId: true }
  });

  console.log('\nREMAINING TENANTS:');
  tenants.forEach((t) => {
    console.log(`  - ${t.name} | ${t.waPhoneId || 'NULL'}`);
  });

  process.exit(0);
}

checkTenants().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
