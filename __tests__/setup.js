/**
 * Setup do Jest - Executado antes de todos os testes
 * Configura variáveis de ambiente e teardown
 */

// Definir NODE_ENV como test
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_do_not_use_in_production';
// NOTE: WHATSAPP_TOKEN, PHONE_NUMBER_ID, META_APP_SECRET are NOT set here
// They are managed per-tenant in the Configuration table
// Tests create Configuration records with mocked data for each tenant
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatsapp_broker_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// NOTE: Webhook credentials are no longer in .env - test fixtures use database values

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
