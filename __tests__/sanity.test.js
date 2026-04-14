/**
 * sanity.test.js - Testes básicos de sanidade
 * Verifica se a infraestrutura de testes está funcionando
 */

describe('Test Infrastructure Sanity Checks', () => {
  it('should have Jest configured and running', () => {
    expect(true).toBe(true);
  });

  it('should load environment variables', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.JWT_SECRET).toBeDefined();
  });

  it('should validate Zod is available', () => {
    const z = require('zod');
    const schema = z.object({
      email: z.string().email(),
      age: z.number().positive()
    });

    const validData = { email: 'test@example.com', age: 25 };
    const result = schema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('should validate Zod rejects invalid data', () => {
    const z = require('zod');
    const schema = z.object({
      email: z.string().email()
    });

    const invalidData = { email: 'not-an-email' };
    const result = schema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it('should have Express available', () => {
    const express = require('express');
    const app = express();
    expect(app).toBeDefined();
    expect(typeof app.use).toBe('function');
  });

  it('should validate rateLimiters configuration', () => {
    const {
      loginLimiter,
      registrationLimiter,
      apiLimiter
    } = require('../src/middleware/rateLimiters');
    expect(loginLimiter).toBeDefined();
    expect(registrationLimiter).toBeDefined();
    expect(apiLimiter).toBeDefined();
  });

  it('should validate validation middleware is configured', () => {
    const {
      validateBody,
      validateParams,
      validateQuery
    } = require('../src/middleware/validation.middleware');
    expect(validateBody).toBeDefined();
    expect(typeof validateBody).toBe('function');
    expect(validateParams).toBeDefined();
    expect(validateQuery).toBeDefined();
  });

  it('should validate auth schemas are defined', () => {
    const { RegisterSchema, LoginSchema } = require('../src/schemas/auth.schemas');
    expect(RegisterSchema).toBeDefined();
    expect(LoginSchema).toBeDefined();
  });

  it('should validate correlation ID middleware exists', () => {
    const {
      correlationIdMiddleware,
      structuredLoggingMiddleware,
      generateCorrelationId
    } = require('../src/middleware/correlationId.middleware');
    expect(correlationIdMiddleware).toBeDefined();
    expect(typeof correlationIdMiddleware).toBe('function');
    expect(structuredLoggingMiddleware).toBeDefined();
    expect(generateCorrelationId).toBeDefined();
  });

  it('should generate valid correlation IDs', () => {
    const { generateCorrelationId } = require('../src/middleware/correlationId.middleware');
    const id = generateCorrelationId();
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    // Should follow format timestamp-random
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
  });

  it('should load audit log service', () => {
    const {
      AuditAction,
      logAuditEvent,
      auditMiddleware
    } = require('../src/services/auditLog.service');
    expect(AuditAction).toBeDefined();
    expect(logAuditEvent).toBeDefined();
    expect(typeof logAuditEvent).toBe('function');
    expect(auditMiddleware).toBeDefined();
  });

  it('should load cache service', () => {
    const { initializeRedis, get, set, del, CacheKeys } = require('../src/services/cache.service');
    expect(initializeRedis).toBeDefined();
    expect(typeof initializeRedis).toBe('function');
    expect(get).toBeDefined();
    expect(set).toBeDefined();
    expect(del).toBeDefined();
    expect(CacheKeys).toBeDefined();
  });

  it('should validate SafeEvaluator is available', () => {
    const SafeEvaluator = require('../src/services/SafeEvaluator');
    expect(SafeEvaluator).toBeDefined();
    expect(typeof SafeEvaluator.evaluate).toBe('function');
    // Test safe evaluation
    const result = SafeEvaluator.evaluate('1 == 1');
    expect(result).toBe(true);
  });
});
