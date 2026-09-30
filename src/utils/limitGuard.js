const prisma = require('../services/database');
const logger = require('./logger');

/**
 * Verifica se o tenant pode iniciar uma nova conversa outbound (disparo ativo)
 * com base no limite mensal.
 * @param {string} tenantId 
 * @returns {Promise<boolean>} retorna true se puder, false se excedeu o limite
 */
async function checkOutboundLimit(tenantId) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { limitMonthlyOutboundChats: true }
    });

    if (!tenant) return false;
    if (tenant.limitMonthlyOutboundChats === 0) return true; // 0 = ilimitado

    // Início do mês atual
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const count = await prisma.conversation.count({
      where: {
        tenantId,
        initiationType: 'OUTBOUND',
        createdAt: { gte: startOfMonth }
      }
    });

    return count < tenant.limitMonthlyOutboundChats;
  } catch (err) {
    logger.error('[LimitGuard] Error checking outbound limit:', err.message);
    return false; // Bloqueia por segurança em caso de falha do banco
  }
}

/**
 * Verifica se o tenant possui uma feature qualitativa ativada
 * @param {string} tenantId 
 * @param {string} featureName 
 * @returns {Promise<boolean>}
 */
async function checkFeatureAccess(tenantId, featureName) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        featureBotBuilder: true,
        featureSurvey: true,
        featureApiAccess: true
      }
    });

    if (!tenant) return false;
    return !!tenant[featureName];
  } catch (err) {
    logger.error('[LimitGuard] Error checking feature access:', err.message);
    return false;
  }
}

module.exports = {
  checkOutboundLimit,
  checkFeatureAccess
};
