/**
 * Setup do Jest - Executado antes de todos os testes
 * Configura variáveis de ambiente e teardown
 */

// Definir NODE_ENV como test
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_do_not_use_in_production';
process.env.WHATSAPP_TOKEN = 'test_token';
process.env.PHONE_NUMBER_ID = 'test_phone_id';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatsapp_broker_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.WEBHOOK_VERIFY_TOKEN = 'test_verify_token';
process.env.META_APP_SECRET = 'test_app_secret';

// Timeout global para testes
jest.setTimeout(10000);

// Limpar console.log em testes (mantém apenas errors)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
