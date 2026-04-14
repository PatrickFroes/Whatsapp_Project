/**
 * BusinessHoursController - Configuração de horário comercial
 */

const BusinessHoursService = require('../services/BusinessHoursService');

class BusinessHoursController {
  /**
   * GET /api/business-hours
   */
  static async getConfig(req, res) {
    try {
      const { tenantId } = req.user;

      const config = await BusinessHoursService.getConfig(tenantId);

      if (!config) {
        // Retornar padrão
        return res.json({
          enabled: false,
          timezone: 'America/Sao_Paulo',
          schedule: BusinessHoursService.getDefaultSchedule(),
          offlineMessage: 'Estamos fora do horário de atendimento. Retornaremos em breve!',
          autoReplyEnabled: true
        });
      }

      res.json(config);
    } catch (error) {
      console.error('Get business hours failed:', error);
      res.status(500).json({ error: 'Failed to get business hours' });
    }
  }

  /**
   * PUT /api/business-hours
   */
  static async updateConfig(req, res) {
    try {
      const { tenantId, role } = req.user;

      // Apenas ADMIN pode configurar
      if (role !== 'ADMIN') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      const config = await BusinessHoursService.configure(tenantId, req.body);

      res.json(config);
    } catch (error) {
      console.error('Update business hours failed:', error);
      res.status(500).json({ error: 'Failed to update business hours' });
    }
  }

  /**
   * GET /api/business-hours/status
   * Verifica se está dentro do horário comercial agora
   */
  static async checkStatus(req, res) {
    try {
      const { tenantId } = req.user;

      const result = await BusinessHoursService.checkBusinessHours(tenantId);

      res.json(result);
    } catch (error) {
      console.error('Check business hours failed:', error);
      res.status(500).json({ error: 'Failed to check business hours' });
    }
  }

  /**
   * GET /api/business-hours/schedule-formatted
   * Retorna horário formatado para exibição
   */
  static async getFormattedSchedule(req, res) {
    try {
      const { tenantId } = req.user;

      const config = await BusinessHoursService.getConfig(tenantId);

      if (!config || !config.schedule) {
        return res.json([]);
      }

      const formatted = BusinessHoursService.formatScheduleForDisplay(config.schedule);

      res.json(formatted);
    } catch (error) {
      console.error('Get formatted schedule failed:', error);
      res.status(500).json({ error: 'Failed to get formatted schedule' });
    }
  }
}

module.exports = BusinessHoursController;
