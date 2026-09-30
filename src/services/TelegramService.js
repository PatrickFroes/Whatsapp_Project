const axios = require('axios');
const logger = require('../utils/logger');

class TelegramService {
  /**
   * Obtém a URL base da API do Telegram para um determinado bot token
   */
  static getApiUrl(token) {
    return `https://api.telegram.org/bot${token}`;
  }

  /**
   * Valida as credenciais do bot e obtém informações básicas
   */
  static async validateBot(token) {
    try {
      const res = await axios.get(`${this.getApiUrl(token)}/getMe`, { timeout: 10000 });
      if (res.data && res.data.ok) {
        return {
          valid: true,
          bot: res.data.result
        };
      }
      return { valid: false, error: 'Resposta inválida do Telegram' };
    } catch (error) {
      logger.error('[TelegramService] Erro ao validar bot:', error.response?.data || error.message);
      return {
        valid: false,
        error: error.response?.data?.description || 'Token inválido ou inacessível'
      };
    }
  }

  /**
   * Registra o webhook do Telegram apontando para o Broker
   */
  static async setWebhook(token, webhookUrl, secretToken = null) {
    try {
      const payload = {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query']
      };
      if (secretToken) {
        payload.secret_token = secretToken;
      }

      const res = await axios.post(`${this.getApiUrl(token)}/setWebhook`, payload, { timeout: 10000 });
      if (res.data && res.data.ok) {
        logger.info(`[TelegramService] Webhook registrado com sucesso: ${webhookUrl}`);
        return { success: true, result: res.data.result };
      }
      return { success: false, error: res.data.description || 'Falha ao registrar webhook' };
    } catch (error) {
      logger.error('[TelegramService] Erro ao registrar webhook:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.description || error.message
      };
    }
  }

  /**
   * Remove o webhook do Telegram
   */
  static async deleteWebhook(token) {
    try {
      const res = await axios.post(`${this.getApiUrl(token)}/deleteWebhook`, {}, { timeout: 10000 });
      return { success: res.data && res.data.ok };
    } catch (error) {
      logger.error('[TelegramService] Erro ao remover webhook:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Envia uma mensagem de texto para o chat do Telegram
   */
  static async sendMessage(token, chatId, text, options = {}) {
    try {
      const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: options.parseMode || undefined
      };

      if (options.replyMarkup) {
        payload.reply_markup = options.replyMarkup;
      }

      const res = await axios.post(`${this.getApiUrl(token)}/sendMessage`, payload, { timeout: 15000 });
      return res.data;
    } catch (error) {
      logger.error(`[TelegramService] Erro ao enviar mensagem para ${chatId}:`, error.response?.data || error.message);
      throw new Error(error.response?.data?.description || 'Falha no envio da mensagem via Telegram');
    }
  }

  /**
   * Envia uma foto para o chat do Telegram
   */
  static async sendPhoto(token, chatId, photoUrl, caption = '') {
    try {
      const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption
      };
      const res = await axios.post(`${this.getApiUrl(token)}/sendPhoto`, payload, { timeout: 20000 });
      return res.data;
    } catch (error) {
      logger.error(`[TelegramService] Erro ao enviar foto para ${chatId}:`, error.response?.data || error.message);
      throw new Error(error.response?.data?.description || 'Falha no envio de foto via Telegram');
    }
  }

  /**
   * Envia um documento/arquivo para o chat do Telegram
   */
  static async sendDocument(token, chatId, documentUrl, caption = '') {
    try {
      const payload = {
        chat_id: chatId,
        document: documentUrl,
        caption: caption
      };
      const res = await axios.post(`${this.getApiUrl(token)}/sendDocument`, payload, { timeout: 20000 });
      return res.data;
    } catch (error) {
      logger.error(`[TelegramService] Erro ao enviar documento para ${chatId}:`, error.response?.data || error.message);
      throw new Error(error.response?.data?.description || 'Falha no envio de documento via Telegram');
    }
  }

  /**
   * Envia um áudio/voz para o chat do Telegram
   */
  static async sendAudio(token, chatId, audioUrl, caption = '') {
    try {
      const payload = {
        chat_id: chatId,
        audio: audioUrl,
        caption: caption
      };
      const res = await axios.post(`${this.getApiUrl(token)}/sendAudio`, payload, { timeout: 20000 });
      return res.data;
    } catch (error) {
      logger.error(`[TelegramService] Erro ao enviar áudio para ${chatId}:`, error.response?.data || error.message);
      throw new Error(error.response?.data?.description || 'Falha no envio de áudio via Telegram');
    }
  }

  /**
   * Obtém a URL para download de um arquivo de mídia enviado pelo usuário no Telegram
   */
  static async getFileUrl(token, fileId) {
    try {
      const res = await axios.get(`${this.getApiUrl(token)}/getFile?file_id=${fileId}`);
      if (res.data && res.data.ok && res.data.result.file_path) {
        return `https://api.telegram.org/file/bot${token}/${res.data.result.file_path}`;
      }
      return null;
    } catch (error) {
      logger.error('[TelegramService] Erro ao obter URL de arquivo:', error.message);
      return null;
    }
  }
}

module.exports = TelegramService;
