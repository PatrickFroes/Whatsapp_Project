const prisma = require('./src/services/database');

async function deleteObsoleteTenants() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   DELETING OBSOLETE TENANTS               ║');
  console.log('║   Keeping: admin & TesteEmpresa           ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    // Get all tenants
    const allTenants = await prisma.tenant.findMany({
      select: { id: true, name: true, waPhoneId: true }
    });

    console.log('Current tenants:', allTenants.length);
    allTenants.forEach((t) => {
      console.log(`  - ${t.name} (${t.waPhoneId || 'NULL'})`);
    });

    const keepNames = ['admin', 'TesteEmpresa'];
    const toDelete = allTenants.filter((t) => !keepNames.includes(t.name));

    if (toDelete.length === 0) {
      console.log('\n✓ No tenants to delete!\n');
      process.exit(0);
    }

    console.log(`\nDeleting ${toDelete.length} tenants...\n`);

    // Delete each tenant's data then the tenant itself
    for (const tenant of toDelete) {
      console.log(`• Deleting "${tenant.name}"...`);

      // Delete related records
      try {
        const msgCount = await prisma.message.deleteMany({ where: { tenantId: tenant.id } });
        console.log(`  ✓ Deleted ${msgCount.count} messages`);
      } catch (e) {
        console.log(`  ⚠️  Message delete error: ${e.message.substring(0, 40)}`);
      }

      try {
        const convCount = await prisma.conversation.deleteMany({
          where: { tenantId: tenant.id }
        });
        console.log(`  ✓ Deleted ${convCount.count} conversations`);
      } catch (e) {
        console.log(`  ⚠️  Conversation delete error: ${e.message.substring(0, 40)}`);
      }

      try {
        const contactCount = await prisma.contact.deleteMany({ where: { tenantId: tenant.id } });
        console.log(`  ✓ Deleted ${contactCount.count} contacts`);
      } catch (e) {
        console.log(`  ⚠️  Contact delete error: ${e.message.substring(0, 40)}`);
      }

      try {
        const configCount = await prisma.configuration.deleteMany({
          where: { tenantId: tenant.id }
        });
        console.log(`  ✓ Deleted ${configCount.count} configurations`);
      } catch (e) {
        console.log(`  ⚠️  Config delete error: ${e.message.substring(0, 40)}`);
      }

      // Delete tenant
      try {
        await prisma.tenant.delete({ where: { id: tenant.id } });
        console.log(`  ✓✓ TENANT DELETED\n`);
      } catch (e) {
        console.log(`  ❌ FAILED TO DELETE TENANT: ${e.message}\n`);
      }
    }

    // Final check
    const remaining = await prisma.tenant.findMany({
      select: { id: true, name: true, waPhoneId: true }
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ FINAL TENANTS:');
    remaining.forEach((t) => {
      console.log(`   - ${t.name} (${t.waPhoneId || 'NULL'})`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

deleteObsoleteTenants();
