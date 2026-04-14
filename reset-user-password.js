// reset-user-password.js
// Script para resetar senha de um usuário

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function resetPassword() {
  const userEmail = process.argv[2];
  const newPassword = process.argv[3];

  if (!userEmail || !newPassword) {
    console.error('Usage: node reset-user-password.js <email> <new-password>');
    console.error('Example: node reset-user-password.js admin@empresa.com NovaSenh@123');
    process.exit(1);
  }

  try {
    console.log(`\n🔄 Buscando usuário: ${userEmail}...`);

    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      include: { tenant: { select: { name: true, slug: true } } }
    });

    if (!user) {
      console.error(`❌ Usuário não encontrado: ${userEmail}`);
      await prisma.$disconnect();
      process.exit(1);
    }

    console.log(`✅ Usuário encontrado:`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Nome: ${user.name}`);
    console.log(`   Tenant: ${user.tenant.name} (${user.tenant.slug})`);
    console.log(`   Role: ${user.role}\n`);

    // Hash a nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualizar no banco
    const updatedUser = await prisma.user.update({
      where: { email: userEmail },
      data: { password: hashedPassword }
    });

    console.log(`✅ SENHA RESETADA COM SUCESSO!\n`);
    console.log(`📝 Novos dados de login:`);
    console.log(`   Email: ${updatedUser.email}`);
    console.log(`   Senha: ${newPassword}\n`);
    console.log(`🔗 Acesso: https://broker.amber.com.br/admin.html\n`);

  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetPassword();
