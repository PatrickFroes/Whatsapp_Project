/**
 * Configuração Centralizada de Constantes
 * Todos os valores hardcoded devem estar aqui
 *
 * Evita duplicação e facilita manutenção
 */

module.exports = {
  // ===================================
  // FLOW ENGINE
  // ===================================
  FLOW: {
    MAX_STEPS: 15,
    MAX_BUTTON_OPTIONS: 3,
    MAX_LIST_OPTIONS: 10,
    MAX_BUTTON_TITLE_LENGTH: 20,
    MAX_LIST_TITLE_LENGTH: 24,
    API_TIMEOUT_MS: 10000
  },

  // ===================================
  // AUTHENTICATION
  // ===================================
  AUTH: {
    JWT_EXPIRY: '24h',
    REFRESH_TOKEN_EXPIRY: '7d',
    BCRYPT_ROUNDS: 10,
    PASSWORD_MIN_LENGTH: 8,
    TOKEN_HEADER_PREFIX: 'Bearer '
  },

  // ===================================
  // RATE LIMITING
  // ===================================
  RATE_LIMIT: {
    // Janela de tempo padrão
    WINDOW_MS: 1 * 60 * 1000, // 1 minuto

    // API geral
    API_MAX: 300,
    API_WINDOW_MS: 1 * 60 * 1000,

    // Autenticação (login/register)
    AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutos
    AUTH_MAX: 50,

    // Endpoints criticos (webhook, admin)
    STRICT_MAX: 10,
    STRICT_WINDOW_MS: 15 * 60 * 1000,

    // Webhook (permissivo, mas sem bypass)
    WEBHOOK_MAX: 100,
    WEBHOOK_WINDOW_MS: 1 * 60 * 1000
  },

  // ===================================
  // MEDIA / UPLOAD
  // ===================================
  MEDIA: {
    MAX_FILE_SIZE: {
      image: 5 * 1024 * 1024, // 5MB
      video: 16 * 1024 * 1024, // 16MB
      audio: 16 * 1024 * 1024, // 16MB
      document: 100 * 1024 * 1024 // 100MB
    },
    TEMP_EXPIRY_HOURS: 24,
    UPLOAD_DIR: 'uploads/temp'
  },

  // ===================================
  // PAGINATION
  // ===================================
  PAGINATION: {
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 500,
    MIN_LIMIT: 1
  },

  // ===================================
  // COOKIES
  // ===================================
  COOKIES: {
    AUTH_TOKEN_NAME: 'auth_token',
    MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 horas
    HTTP_ONLY: true,
    SAME_SITE: 'Lax'
  },

  // ===================================
  // DATABASE
  // ===================================
  DATABASE: {
    PRISMA_LOG_DEVELOPMENT: ['warn', 'error'],
    PRISMA_LOG_PRODUCTION: ['error']
  },

  // ===================================
  // LOGGING
  // ===================================
  LOGGING: {
    MAX_SENSITIVE_DATA_LENGTH: 100,
    EMAIL_MASK_PATTERN: 3, // Mostrar primeiros 3 caracteres
    PHONE_MASK_PATTERN: 4 // Mostrar últimos 4 dígitos
  },

  // ===================================
  // VALIDATION
  // ===================================
  VALIDATION: {
    EMAIL_MAX_LENGTH: 255,
    STRING_MAX_LENGTH: 1000,
    SLUG_MIN_LENGTH: 2,
    SLUG_MAX_LENGTH: 50,
    UUID_FORMAT: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  },

  // ===================================
  // BUSINESS LOGIC
  // ===================================
  BUSINESS: {
    DEFAULT_TIMEZONE: 'America/Sao_Paulo',
    DEFAULT_BUSINESS_HOURS_START: '09:00',
    DEFAULT_BUSINESS_HOURS_END: '18:00',
    MAX_CONCURRENT_CHATS_PER_AGENT: 5,
    OFFLINE_MESSAGE_DEFAULT: 'Estamos fora do horário de atendimento. Retornaremos em breve!'
  },

  // ===================================
  // EXPORT / LGPD
  // ===================================
  LGPD: {
    EXPORT_MESSAGE_WINDOW_DAYS: 90,
    MAX_MESSAGES_EXPORT: 10000,
    EXPORT_RETENTION_DAYS: 30
  },

  // ===================================
  // ROLES & PERMISSIONS
  // ===================================
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    SUPERVISOR: 'SUPERVISOR',
    AGENT: 'AGENT'
  },

  // Work statuses
  WORK_STATUS: {
    ONLINE: 'ONLINE',
    BUSY: 'BUSY',
    AWAY: 'AWAY',
    PAUSED: 'PAUSED',
    OFFLINE: 'OFFLINE'
  },

  // ===================================
  // CONVERSATION STATUS
  // ===================================
  CONVERSATION_STATUS: {
    BOT: 'BOT',
    QUEUED: 'QUEUED',
    ASSIGNED: 'ASSIGNED',
    RESOLVED: 'RESOLVED',
    CLOSED: 'CLOSED'
  },

  // ===================================
  // HEALTH CHECK
  // ===================================
  HEALTH: {
    STARTUP_TIMEOUT_MS: 5000,
    READY_TIMEOUT_MS: 10000
  }
};
