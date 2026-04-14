const { PrismaClient } = require('@prisma/client');

// Prevent multiple instances in development due to hot reloading
let prisma;

const prismaOptions = {
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
};

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient(prismaOptions);
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient(prismaOptions);
  }
  prisma = global.prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
