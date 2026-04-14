/**
 * BusinessHoursService - Gerenciamento de horário comercial
 */

const prisma = require('./database');

class BusinessHoursService {
  /**
   * Configura horário comercial do tenant
   */
  static async configure(tenantId, config) {
    const {
      enabled,
      timezone,
      schedule, // { monday: { start: "09:00", end: "18:00" }, ... }
      offlineMessage,
      autoReplyEnabled
    } = config;

    const businessHours = {
      enabled: enabled !== false,
      timezone: timezone || 'America/Sao_Paulo',
      schedule: schedule || this.getDefaultSchedule(),
      offlineMessage:
        offlineMessage || 'Estamos fora do horário de atendimento. Retornaremos em breve!',
      autoReplyEnabled: autoReplyEnabled !== false
    };

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        businessHours
      }
    });

    return businessHours;
  }

  /**
   * Retorna horário padrão (seg-sex 9h-18h)
   */
  static getDefaultSchedule() {
    const workdays = {
      start: '09:00',
      end: '18:00',
      enabled: true
    };

    return {
      monday: { ...workdays },
      tuesday: { ...workdays },
      wednesday: { ...workdays },
      thursday: { ...workdays },
      friday: { ...workdays },
      saturday: { enabled: false },
      sunday: { enabled: false }
    };
  }

  /**
   * Verifica se está dentro do horário comercial
   */
  static isWithinBusinessHours(businessHours) {
    if (!businessHours || !businessHours.enabled) {
      return true; // Se não configurado, sempre aberto
    }

    const { schedule, timezone } = businessHours;

    // Obter data/hora no timezone do tenant
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday').value.toLowerCase();
    const hour = parts.find((p) => p.type === 'hour').value;
    const minute = parts.find((p) => p.type === 'minute').value;
    const currentTime = `${hour}:${minute}`;

    // Verificar se dia está habilitado
    const daySchedule = schedule[weekday];
    if (!daySchedule || !daySchedule.enabled) {
      return false;
    }

    // Verificar se está dentro do horário
    const { start, end } = daySchedule;

    if (currentTime >= start && currentTime <= end) {
      return true;
    }

    return false;
  }

  /**
   * Retorna próximo horário de atendimento
   */
  static getNextBusinessTime(businessHours) {
    if (!businessHours || !businessHours.enabled) {
      return null;
    }

    const { schedule, timezone } = businessHours;
    const now = new Date();

    const daysOfWeek = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday'
    ];

    // Percorrer próximos 7 dias
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(now);
      checkDate.setDate(checkDate.getDate() + i);

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long'
      });

      const weekday = formatter.format(checkDate).toLowerCase();
      const daySchedule = schedule[weekday];

      if (daySchedule && daySchedule.enabled) {
        const [startHour, startMinute] = daySchedule.start.split(':');

        const nextTime = new Date(checkDate);
        nextTime.setHours(parseInt(startHour), parseInt(startMinute), 0, 0);

        // Se for hoje, verificar se já passou
        if (i === 0 && nextTime <= now) {
          continue;
        }

        return {
          date: nextTime,
          dayOfWeek: weekday,
          time: daySchedule.start
        };
      }
    }

    return null;
  }

  /**
   * Formata mensagem de fora de horário
   */
  static getOfflineMessage(businessHours) {
    if (!businessHours || !businessHours.offlineMessage) {
      return 'Estamos fora do horário de atendimento. Retornaremos em breve!';
    }

    const nextTime = this.getNextBusinessTime(businessHours);

    let message = businessHours.offlineMessage;

    // Adicionar próximo horário se disponível
    if (nextTime) {
      const dayNames = {
        monday: 'Segunda-feira',
        tuesday: 'Terça-feira',
        wednesday: 'Quarta-feira',
        thursday: 'Quinta-feira',
        friday: 'Sexta-feira',
        saturday: 'Sábado',
        sunday: 'Domingo'
      };

      message += `\n\nPróximo atendimento: ${dayNames[nextTime.dayOfWeek]} às ${nextTime.time}`;
    }

    return message;
  }

  /**
   * Middleware para verificar horário comercial
   */
  static async checkBusinessHours(tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessHours: true }
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const businessHours = tenant.businessHours;
    const isOpen = this.isWithinBusinessHours(businessHours);

    return {
      isOpen,
      businessHours,
      offlineMessage: !isOpen ? this.getOfflineMessage(businessHours) : null,
      nextBusinessTime: !isOpen ? this.getNextBusinessTime(businessHours) : null
    };
  }

  /**
   * Obtém configuração do tenant
   */
  static async getConfig(tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessHours: true }
    });

    return tenant?.businessHours || null;
  }

  /**
   * Formata horário para exibição
   */
  static formatScheduleForDisplay(schedule) {
    const dayNames = {
      monday: 'Segunda',
      tuesday: 'Terça',
      wednesday: 'Quarta',
      thursday: 'Quinta',
      friday: 'Sexta',
      saturday: 'Sábado',
      sunday: 'Domingo'
    };

    const formatted = [];

    for (const [day, config] of Object.entries(schedule)) {
      if (config.enabled) {
        formatted.push({
          day: dayNames[day],
          hours: `${config.start} - ${config.end}`
        });
      }
    }

    return formatted;
  }
}

module.exports = BusinessHoursService;
