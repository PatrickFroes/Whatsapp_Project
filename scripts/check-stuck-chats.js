const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const convs = await prisma.conversation.findMany({
    where: {
      status: { notIn: ['RESOLVED', 'CLOSED'] }
    },
    include: {
      contact: true,
      assignedTo: { select: { id: true, name: true, email: true } }
    }
  });
  console.log('--- ACTIVE CONVERSATIONS ---');
  console.log(JSON.stringify(convs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
