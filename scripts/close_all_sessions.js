const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function closeAllSessions() {
  try {
    console.log('Encerrando todas as sessões (incluindo RESOLVED)...');

    const result = await prisma.conversation.updateMany({
      where: {
        status: {
          in: ['QUEUED', 'ASSIGNED', 'BOT', 'RESOLVED']
        }
      },
      data: {
        status: 'CLOSED',
        disposition: 'ENCERRAMENTO_ADMINISTRATIVO'
      }
    });

    console.log(`✅ ${result.count} sessões encerradas permanentemente (CLOSED)`);
  } catch (error) {
    console.error('❌ Erro ao encerrar sessões:', error);
  } finally {
    await prisma.$disconnect();
  }
}

closeAllSessions();
