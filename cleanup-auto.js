/**
 * DELETE obsolete tenants (NON-INTERACTIVE)
 * Automatically deletes: Teste ABC, Empresa
 * Keeps: admin, TesteEmpresa
 */

const prisma = require('./src/services/database');

async function deleteObsoleteTenants() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   DELETE OBSOLETE TENANTS (AUTO)           ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const keepNames = ['admin', 'TesteEmpresa'];

  // Find all tenants
  const allTenants = await prisma.tenant.findMany({
    select: { id: true, name: true }
  });

  const toDelete = allTenants.filter((t) => !keepNames.includes(t.name));

  console.log(`Tenants to delete: ${toDelete.length}`);
  toDelete.forEach((t) => console.log(`  - ${t.name}`));

  if (toDelete.length === 0) {
    console.log('✅ No tenants to delete');
    process.exit(0);
  }

  console.log('\n🔄 Deleting...');

  for (const tenant of toDelete) {
    try {
      // Delete in order
      await prisma.message.deleteMany({ where: { conversation: { tenantId: tenant.id } } });
      await prisma.conversation.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.contact.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.configuration.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });

      console.log(`✅ ${tenant.name}`);
    } catch (error) {
      console.error(`❌ ${tenant.name}: ${error.message}`);
    }
  }

  const remaining = await prisma.tenant.findMany({ select: { name: true } });
  console.log(`\n✅ Done! Remaining: ${remaining.map((t) => t.name).join(', ')}`);
  process.exit(0);
}

deleteObsoleteTenants().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
