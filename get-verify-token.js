const prisma = require('./src/services/database');
(async () => {
  try {
    const config = await prisma.configuration.findFirst();
    console.log('🔍 Verify Token:', config?.verifyToken || 'NOT FOUND');
    console.log('🔍 MetaAppSecret:', config?.metaAppSecret ? '✓ SET' : '✗ NOT SET');
    console.log('🔍 WhatsappToken:', config?.whatsappToken ? '✓ SET' : '✗ NOT SET');
    console.log('🔍 PhoneNumberId:', config?.phoneNumberId || 'NOT SET');
    process.exit(0);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
