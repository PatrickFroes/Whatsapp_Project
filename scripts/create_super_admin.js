const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createSuperAdmin() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: node create_super_admin.js <email> <password>');
    process.exit(1);
  }

  try {
    // 1. Ensure a "System" Tenant exists for the Super Admins
    // We use a reserved slug 'system-admin'
    let systemTenant = await prisma.tenant.findUnique({
      where: { slug: 'system-admin' }
    });

    if (!systemTenant) {
      console.log('Creating System Tenant...');
      systemTenant = await prisma.tenant.create({
        data: {
          name: 'Platform Administration',
          slug: 'system-admin',
          plan: 'enterprise',
          active: true
        }
      });
    }

    // 2. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      console.error(`User with email ${email} already exists.`);
      process.exit(1);
    }

    // 3. Create Super Admin
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: 'Super Administrator',
        email: email,
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        tenantId: systemTenant.id,
        workStatus: 'OFFLINE' // Default
      }
    });

    console.log(`
    ✅ Super Admin Created Successfully!
    ----------------------------------
    User:  ${user.name}
    Email: ${user.email}
    Role:  ${user.role}
    Tenant: ${systemTenant.name}
    ----------------------------------
    You can now access /super.html
    `);
  } catch (error) {
    console.error('Error creating super admin:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createSuperAdmin();
