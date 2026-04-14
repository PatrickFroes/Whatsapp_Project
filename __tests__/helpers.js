/**
 * Test Utilities
 * Helpers para facilitar testes
 */

const jwt = require('jsonwebtoken');

/**
 * Gera um JWT válido para testes
 */
const generateTestToken = (overrides = {}) => {
  const payload = {
    userId: 'test-user-id',
    tenantId: 'test-tenant-id',
    role: 'AGENT',
    ...overrides
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
};

/**
 * Cria headers de autenticação padrão
 */
const getAuthHeaders = (token) => {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

/**
 * Mock de tenant padrão
 */
const mockTenant = (overrides = {}) => {
  return {
    id: 'test-tenant-id',
    name: 'Test Tenant',
    slug: 'test-tenant',
    plan: 'free',
    active: true,
    waPhoneId: 'test-phone-id',
    waAccessToken: 'test-wa-token',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
};

/**
 * Mock de usuário padrão
 */
const mockUser = (overrides = {}) => {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    password: 'hashed_password',
    name: 'Test User',
    role: 'AGENT',
    workStatus: 'ONLINE',
    tenantId: 'test-tenant-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
};

/**
 * Aguarda promise ou timeout
 */
const waitFor = (condition, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 50;
      if (condition()) {
        clearInterval(interval);
        resolve();
      } else if (elapsed > timeout) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for condition'));
      }
    }, 50);
  });
};

module.exports = {
  generateTestToken,
  getAuthHeaders,
  mockTenant,
  mockUser,
  waitFor
};
