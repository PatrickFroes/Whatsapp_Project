/**
 * Delete obsolete tenants
 * Keep only: admin and TesteEmpresa
 * Delete all others
 */

const prisma = require('./src/services/database');

async function deleteObsoleteTenants() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   DELETE OBSOLETE TENANTS                  ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // 1. Find all tenants
  console.log('1️⃣  Listing all tenants...');
  const allTenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      waPhoneId: true,
      _count: {
        select: {
          conversations: true,
          contacts: true
        }
      }
    }
  });

  console.log(`Found ${allTenants.length} tenants:\n`);
  allTenants.forEach((t) => {
    console.log(`  • ${t.name.padEnd(20)} | waPhoneId: ${t.waPhoneId || 'NULL'}`);
    console.log(`    └─ Conv: ${t._count.conversations}, Contacts: ${t._count.contacts}`);
  });

  // 2. Identify tenants to delete
  const keepNames = ['admin', 'TesteEmpresa'];
  const toDelete = allTenants.filter((t) => !keepNames.includes(t.name));

  if (toDelete.length === 0) {
    console.log('\n✅ No tenants to delete. Already clean!');
    process.exit(0);
  }

  console.log(`\n2️⃣  Tenants to DELETE (${toDelete.length}):`);
  toDelete.forEach((t) => {
    console.log(`  ❌ ${t.name}`);
  });

  console.log(`\n3️⃣  Tenants to KEEP:`);
  allTenants
    .filter((t) => keepNames.includes(t.name))
    .forEach((t) => {
      console.log(`  ✅ ${t.name}`);
    });

  // 3. Confirm before deletion
  console.log('\n⚠️  WARNING: This will delete:');
  toDelete.forEach((t) => {
    console.log(
      `  - ${t.name}: ${t._count.conversations} conversations`
    );
  });

  console.log('\n4️⃣  Deleting tenants...');

  // Delete using cascade/transactions
  for (const tenant of toDelete) {
    try {
      console.log(`  Deleting "${tenant.name}"...`);

      // Delete related records in order
      // 1. Messages (depends on conversations)
      await prisma.message.deleteMany({
        where: { conversation: { tenantId: tenant.id } }
      });
      console.log(`    ✓ Messages deleted`);

      // 2. Conversations
      await prisma.conversation.deleteMany({
        where: { tenantId: tenant.id }
      });
      console.log(`    ✓ Conversations deleted`);

      // 3. Contacts
      await prisma.contact.deleteMany({
        where: { tenantId: tenant.id }
      });
      console.log(`    ✓ Contacts deleted`);

      // 4. Configuration
      await prisma.configuration.deleteMany({
        where: { tenantId: tenant.id }
      });
      console.log(`    ✓ Configuration deleted`);

      // 5. AuditLog
      await prisma.auditLog.deleteMany({
        where: { tenantId: tenant.id }
      });
      console.log(`    ✓ AuditLog deleted`);

      // 6. Finally, delete tenant
      await prisma.tenant.delete({
        where: { id: tenant.id }
      });
      console.log(`  ✅ "${tenant.name}" deleted successfully\n`);
    } catch (error) {
      console.error(`  ❌ Error deleting "${tenant.name}":`, error.message);
    }
  }

  // 4. Verify result
  console.log('\n5️⃣  Verification - Remaining tenants:');
  const remaining = await prisma.tenant.findMany({
    select: { id: true, name: true, waPhoneId: true }
  });

  remaining.forEach((t) => {
    const status = keepNames.includes(t.name) ? '✅' : '⚠️';
    console.log(`  ${status} ${t.name} | waPhoneId: ${t.waPhoneId || 'NULL'}`);
  });

  console.log(`\n✅ Cleanup complete! ${toDelete.length} tenants deleted, ${remaining.length} remaining.\n`);
  process.exit(0);
}

deleteObsoleteTenants().catch((err) => {
  console.error('❌ ERROR:', err.message);
  process.exit(1);
});
