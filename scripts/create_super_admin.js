const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] || 'admin@broker.com.br';
  const password = process.argv[3] || 'MinhaSenh@123';

  console.log(`Creating Super Admin with email: ${email}`);

  // Create super admin tenant
  let tenant = await prisma.tenant.findUnique({
    where: { slug: 'platform-admin' }
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Platform Administration',
        slug: 'platform-admin',
        plan: 'super-admin'
      }
    });
  }

  // Create super admin user
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    console.log('User already exists, updating password and role...');
    await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        tenantId: tenant.id
      }
    });
  } else {
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: 'Super Administrator',
        role: 'SUPER_ADMIN',
        tenantId: tenant.id
      }
    });
  }

  console.log(`
✅ Super Admin Created Successfully!
----------------------------------
User:  Super Administrator
Email: ${email}
Role:  SUPER_ADMIN
Tenant: Platform Administration
----------------------------------
You can now access /super.html
  `);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
