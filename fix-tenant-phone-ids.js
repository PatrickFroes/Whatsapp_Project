// fix-tenant-phone-ids.js
// Sincronizar Tenant.waPhoneId com Configuration.phoneNumberId

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function fix() {
  try {
    console.log('\n=== SINCRONIZANDO TENANT PHONE IDs ===\n');
    
    const configs = await p.configuration.findMany({
      include: {
        tenant: {
          select: { name: true, slug: true }
        }
      }
    });

    if (configs.length === 0) {
      console.log('❌ Nenhuma Configuration encontrada');
      return;
    }

    for (const config of configs) {
      const updated = await p.tenant.update({
        where: { id: config.tenantId },
        data: { waPhoneId: config.phoneNumberId }
      });
      
      console.log(`✅ Tenant: ${config.tenant.name} (${config.tenant.slug})`);
      console.log(`   Atualizado waPhoneId: ${config.phoneNumberId}\n`);
    }

    console.log(`✅ Sincronização concluída! ${configs.length} tenant(s) atualizados.\n`);
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await p.$disconnect();
  }
}

fix();
