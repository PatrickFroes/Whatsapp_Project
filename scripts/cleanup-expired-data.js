/**
 * cleanup-expired-data.js
 * Script executado periodicamente (Cron) para realizar a limpeza de dados expirados
 * com base na retencao (limitStorageDays) configurada por tenant.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');

const prisma = new PrismaClient();

async function runCleanup() {
  logger.info('[Cleanup] Starting expired message and media cleanup task...');
  let totalDeletedMessages = 0;
  let totalDeletedFiles = 0;

  try {
    const tenants = await prisma.tenant.findMany({
      where: { active: true },
      select: { id: true, name: true, limitStorageDays: true }
    });

    for (const tenant of tenants) {
      const days = tenant.limitStorageDays;
      if (!days || days <= 0) {
        logger.info(`[Cleanup] Tenant "${tenant.name}" (${tenant.id}) has unlimited retention. Skipping.`);
        continue;
      }

      // Calcula a data limite de expiração
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() - days);

      logger.info(`[Cleanup] Cleaning data for "${tenant.name}" older than ${days} days (${expirationDate.toISOString()})`);

      // 1. Busca mensagens do tenant anteriores à data de expiração que possuem mídia vinculada
      const messagesWithMedia = await prisma.message.findMany({
        where: {
          chat: { tenantId: tenant.id },
          createdAt: { lt: expirationDate },
          contentType: { in: ['image', 'video', 'audio', 'document'] },
          content: { startsWith: 'uploads/' } // Mídias locais salvas no servidor
        },
        select: { id: true, content: true }
      });

      // Remove arquivos locais do disco
      for (const msg of messagesWithMedia) {
        try {
          const filePath = path.join(__dirname, '..', msg.content);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            totalDeletedFiles++;
          }
        } catch (fileErr) {
          logger.error(`[Cleanup] Failed to delete file "${msg.content}":`, fileErr.message);
        }
      }

      // 2. Remove registros de mensagens expiradas do banco
      const deletedCount = await prisma.message.deleteMany({
        where: {
          chat: { tenantId: tenant.id },
          createdAt: { lt: expirationDate }
        }
      });

      totalDeletedMessages += deletedCount.count;
      logger.info(`[Cleanup] Tenant "${tenant.name}": deleted ${deletedCount.count} messages and ${messagesWithMedia.length} files.`);
    }

    logger.info(`[Cleanup] Task completed successfully. Total messages deleted: ${totalDeletedMessages}, Total files deleted: ${totalDeletedFiles}`);
  } catch (err) {
    logger.error('[Cleanup] Catastrophic error in cleanup cron task:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Executa caso rodado diretamente
if (require.main === module) {
  runCleanup();
}

module.exports = runCleanup;
