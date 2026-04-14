const prisma = require('./src/services/database');

(async () => {
  const tenant = await prisma.tenant.findFirst({
    where: {
      name: {
        contains: 'TesteEmpresa',
        mode: 'insensitive'
      }
    },
    include: {
      configuration: {
        select: {
          phoneNumberId: true,
          verifyToken: true,
          metaAppSecret: true
        }
      }
    }
  });

  if (!tenant) {
    console.error('TesteEmpresa not found');
    process.exit(1);
  }

  console.log('Tenant Info:');
  console.log('  ID:', tenant.id);
  console.log('  Name:', tenant.name);
  console.log('  waPhoneId:', tenant.waPhoneId);
  console.log('  waBusinessId:', tenant.waBusinessId);
  console.log('  Configuration:');
  console.log('    - phoneNumberId:', tenant.configuration?.phoneNumberId);
  console.log('    - verifyToken:', tenant.configuration?.verifyToken ? 'SET ✓' : 'MISSING');
  console.log('    - metaAppSecret:', tenant.configuration?.metaAppSecret ? 'SET ✓' : 'MISSING');

  process.exit(0);
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
