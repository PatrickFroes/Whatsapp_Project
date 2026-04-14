/**
 * Verify and set whatsappToken for TesteEmpresa
 */

const prisma = require('./src/services/database');

async function fixCredentials() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   FIXING TESTEEMPRESA WHATSAPP TOKEN      ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  try {
    // Get TesteEmpresa
    const tenant = await prisma.tenant.findFirst({
      where: { name: 'TesteEmpresa' }
    });

    if (!tenant) {
      console.error('❌ TesteEmpresa tenant not found');
      process.exit(1);
    }

    console.log(`✓ Found tenant: ${tenant.name} (${tenant.id})`);

    // Get its configuration
    const config = await prisma.configuration.findUnique({
      where: { tenantId: tenant.id }
    });

    if (!config) {
      console.error('❌ No Configuration found for TesteEmpresa');
      process.exit(1);
    }

    console.log('\n📋 Current Configuration:');
    console.log(`  phoneNumberId: ${config.phoneNumberId || '❌ MISSING'}`);
    console.log(`  verifyToken: ${config.verifyToken ? '✓' : '❌ MISSING'}`);
    console.log(`  whatsappToken: ${config.whatsappToken ? '✓' : '❌ MISSING'}`);
    console.log(`  metaAppSecret: ${config.metaAppSecret ? '✓' : '❌ MISSING'}`);

    // If whatsappToken is missing, try to use the one from env
    if (!config.whatsappToken && process.env.WHATSAPP_TOKEN) {
      console.log(`\n⚡ Setting whatsappToken from environment...`);
      const updated = await prisma.configuration.update({
        where: { tenantId: tenant.id },
        data: { whatsappToken: process.env.WHATSAPP_TOKEN }
      });
      console.log(`✅ Updated! whatsappToken is now SET`);
    } else if (!config.whatsappToken) {
      console.log(`\n⚠️  No whatsappToken available!`);
      console.log(`   - Configuration.whatsappToken is NULL`);
      console.log(`   - process.env.WHATSAPP_TOKEN is not set`);
      console.log(`   ➜ Please set via admin panel or environment`);
    } else {
      console.log(`\n✅ whatsappToken already SET - all good!`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixCredentials();
