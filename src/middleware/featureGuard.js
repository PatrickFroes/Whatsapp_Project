const prisma = require('../services/database');
const logger = require('../utils/logger');

/**
 * Middleware para bloquear acesso a rotas cujos recursos qualitativos
 * (feature flags) não estão licenciados para o tenant.
 * @param {string} featureName Nome do campo booleano no modelo Tenant
 */
function checkFeature(featureName) {
  return async (req, res, next) => {
    try {
      const { tenantId } = req.user;
      
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant ID not found in request context' });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          featureBotBuilder: true,
          featureSurvey: true,
          featureApiAccess: true,
          featureAiSummary: true,
          featureQueueAlert: true,
          featureCloseWebhook: true,
          featureWebchat: true
        }
      });

      if (!tenant || !tenant[featureName]) {
        logger.warn(`[FeatureGuard] Access denied to feature "${featureName}" for tenant ${tenantId}`);
        return res.status(403).json({
          error: 'Feature locked',
          details: 'Este recurso não está licenciado na conta de sua empresa. Entre em contato com o suporte para contratá-lo.'
        });
      }

      next();
    } catch (err) {
      logger.error(`[FeatureGuard] Error validating feature "${featureName}":`, err.message);
      return res.status(500).json({ error: 'Erro interno na validação de licenciamento.' });
    }
  };
}

module.exports = {
  checkFeature
};
