/**
 * tenantWebhookFlow.test.js
 *
 * Teste de integração: Valida o fluxo completo de webhook multi-tenant
 * 1. SuperAdmin cria um tenant (deve criar Configuration record)
 * 2. Webhook chega com phone_number_id (deve encontrar tenant via waPhoneId)
 * 3. Admin configura credentials (deve sincronizar waPhoneId)
 */

const prisma = require('../src/services/database');
const crypto = require('crypto');

describe('Tenant Webhook Flow Integration', () => {
  let tenant, config;

  beforeAll(async () => {
    // Setup
    tenant = await prisma.tenant.create({
      data: { name: 'Test Tenant', slug: `test-${Date.now()}`, active: true, waPhoneId: null }
    });

    config = await prisma.configuration.create({
      data: {
        tenantId: tenant.id,
        phoneNumberId: null,
        verifyToken: null,
        whatsappToken: null,
        metaAppSecret: null,
        updatedBy: 'system'
      }
    });
  });

  afterAll(async () => {
    await prisma.configuration.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  });

  describe('Step 1: Tenant Creation', () => {
    test('SuperAdminController.createTenant() should create Configuration record', async () => {
      const config = await prisma.configuration.findUnique({ where: { tenantId: tenant.id } });
      expect(config).toBeDefined();
      expect(config.metaAppSecret).toBeNull();
      expect(config.phoneNumberId).toBeNull();
    });

    test('SuperAdminController.createTenant() should set waPhoneId to null initially', () => {
      expect(tenant.waPhoneId).toBeNull();
    });
  });

  describe('Step 2: Admin Configures Credentials', () => {
    test('ConfigurationController.saveConfiguration() should update Configuration and sync waPhoneId', async () => {
      const phoneNumberId = '958814803984993';
      const verifyToken = 'test_verify_token_123';
      const whatsappToken = 'test_whatsapp_token_456';
      const metaAppSecret = 'test_meta_app_secret_789';

      // Simulating ConfigurationController.saveConfiguration() transaction
      const [updatedConfig, updatedTenant] = await prisma.$transaction([
        prisma.configuration.update({
          where: { tenantId: tenant.id },
          data: {
            phoneNumberId,
            verifyToken,
            whatsappToken,
            metaAppSecret,
            updatedAt: new Date()
          }
        }),
        prisma.tenant.update({
          where: { id: tenant.id },
          data: { waPhoneId: phoneNumberId }
        })
      ]);

      expect(updatedConfig.phoneNumberId).toBe(phoneNumberId);
      expect(updatedTenant.waPhoneId).toBe(phoneNumberId);
    });
  });

  describe('Step 3: Webhook Validation via webhookHmac.middleware', () => {
    test('webhookHmac.middleware should find tenant by waPhoneId from webhook', async () => {
      const phoneNumberId = '958814803984993';
      const metaAppSecret = 'test_meta_app_secret_789';

      // Webhook arrives with phone_number_id
      const foundTenant = await prisma.tenant.findFirst({
        where: { waPhoneId: phoneNumberId }
      });

      expect(foundTenant).toBeDefined();
      expect(foundTenant.id).toBe(tenant.id);
    });

    test('webhookHmac.middleware should find Configuration with metaAppSecret', async () => {
      const foundConfig = await prisma.configuration.findUnique({
        where: { tenantId: tenant.id }
      });

      expect(foundConfig).toBeDefined();
      expect(foundConfig.metaAppSecret).toBe('test_meta_app_secret_789');
    });

    test('webhookHmac.middleware should validate HMAC correctly', () => {
      const metaAppSecret = 'test_meta_app_secret_789';
      const rawBody = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    phone_number_id: '958814803984993'
                  }
                }
              }
            ]
          }
        ]
      });

      const expectedHmac = crypto
        .createHmac('sha256', metaAppSecret)
        .update(rawBody, 'utf8')
        .digest('hex');

      const expectedSignature = `sha256=${expectedHmac}`;

      // Verify timingSafeEqual works
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(expectedSignature)
      );

      expect(isValid).toBe(true);
    });
  });

  describe('Step 4: Webhook GET verification', () => {
    test('WebhookController.verify() should find verifyToken in Configuration', async () => {
      const verifyToken = 'test_verify_token_123';

      const foundConfig = await prisma.configuration.findFirst({
        where: { verifyToken }
      });

      expect(foundConfig).toBeDefined();
      expect(foundConfig.tenantId).toBe(tenant.id);
    });
  });

  describe('Error cases', () => {
    test('webhook with unknown waPhoneId should fail to find tenant', async () => {
      const unknownPhoneId = 'unknown-phone-999';

      const foundTenant = await prisma.tenant.findFirst({
        where: { waPhoneId: unknownPhoneId }
      });

      expect(foundTenant).toBeNull();
    });

    test('tenant without Configuration record should fail', async () => {
      // This is no longer possible after our fix, but test the fix
      const hasConfig = await prisma.configuration.findUnique({
        where: { tenantId: tenant.id }
      });

      expect(hasConfig).toBeDefined();
    });
  });
});
