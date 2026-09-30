const prisma = require('../services/database');
const logger = require('../utils/logger');
const TelegramService = require('../services/TelegramService');

class TelegramConfigController {
  /**
   * GET /api/telegram/config
   * Obtém a configuração atual do Telegram para o tenant logado
   */
  static async getConfig(req, res) {
    try {
      const { tenantId } = req.user;
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { telegramConfig: true }
      });

      const config = tenant?.telegramConfig || { enabled: false };
      
      // Mascarar o token por segurança se existir
      if (config.botToken) {
        config.botTokenMasked = `${config.botToken.substring(0, 8)}...${config.botToken.substring(config.botToken.length - 4)}`;
      }

      res.json(config);
    } catch (error) {
      logger.error('[TelegramConfigController] getConfig error:', error);
      res.status(500).json({ error: 'Erro ao buscar configurações do Telegram' });
    }
  }

  /**
   * POST /api/telegram/config
   * Salva o token do bot, valida e registra o webhook no Telegram
   */
  static async saveConfig(req, res) {
    try {
      const { tenantId } = req.user;
      const { botToken, enabled = true, flowId = null, welcomeMessage = '' } = req.body;

      if (!botToken || botToken.trim().length === 0) {
        return res.status(400).json({ error: 'O Token do Bot do Telegram é obrigatório' });
      }

      const cleanToken = botToken.trim();

      // 1. Validar o Bot na API do Telegram
      const validation = await TelegramService.validateBot(cleanToken);
      if (!validation.valid) {
        return res.status(400).json({
          error: `Token do Telegram inválido: ${validation.error}`
        });
      }

      const botInfo = validation.bot;

      // 2. Determinar a URL do Webhook
      const appUrl = process.env.APP_URL || process.env.BASE_URL || `https://${req.get('host')}`;
      const webhookUrl = `${appUrl}/api/webhooks/telegram/${tenantId}`;

      // 3. Registrar o Webhook no Telegram
      const webhookRes = await TelegramService.setWebhook(cleanToken, webhookUrl);
      if (!webhookRes.success) {
        return res.status(400).json({
          error: `Não foi possível registrar o webhook no Telegram: ${webhookRes.error}`
        });
      }

      // 4. Salvar configuração no Tenant
      const telegramConfigData = {
        enabled: Boolean(enabled),
        botToken: cleanToken,
        botId: botInfo.id,
        botName: botInfo.first_name,
        botUsername: botInfo.username,
        webhookUrl: webhookUrl,
        flowId: flowId || null,
        welcomeMessage: welcomeMessage || null,
        status: 'CONNECTED',
        connectedAt: new Date().toISOString()
      };

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          telegramConfig: telegramConfigData
        }
      });

      logger.info(`[TelegramConfigController] Bot @${botInfo.username} conectado com sucesso para o tenant ${tenantId}`);

      res.json({
        success: true,
        message: `Bot @${botInfo.username} conectado com sucesso!`,
        config: telegramConfigData
      });
    } catch (error) {
      logger.error('[TelegramConfigController] saveConfig error:', error);
      res.status(500).json({ error: 'Erro ao conectar bot do Telegram' });
    }
  }

  /**
   * DELETE /api/telegram/config
   * Desconecta o bot e remove o webhook do Telegram
   */
  static async disconnect(req, res) {
    try {
      const { tenantId } = req.user;
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { telegramConfig: true }
      });

      const config = tenant?.telegramConfig;
      if (config && config.botToken) {
        await TelegramService.deleteWebhook(config.botToken);
      }

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          telegramConfig: { enabled: false, status: 'DISCONNECTED' }
        }
      });

      res.json({ success: true, message: 'Canal Telegram desconectado com sucesso' });
    } catch (error) {
      logger.error('[TelegramConfigController] disconnect error:', error);
      res.status(500).json({ error: 'Erro ao desconectar Telegram' });
    }
  }
}

module.exports = TelegramConfigController;
