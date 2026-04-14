jest.mock('../src/services/database', () => ({
  tenant: { findFirst: jest.fn() },
  configuration: { findUnique: jest.fn() }
}));

const crypto = require('crypto');
const prisma = require('../src/services/database');
const { validateWebhookHmac } = require('../src/middleware/webhookHmac.middleware');

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('validateWebhookHmac multi-tenant routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects webhook when phone_number_id does not map to a tenant', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'unknown-phone' } } }] }]
    });

    prisma.tenant.findFirst.mockResolvedValue(null);

    const req = {
      headers: { 'x-hub-signature-256': 'sha256=any' },
      rawBody: body
    };
    const res = buildRes();
    const next = jest.fn();

    await validateWebhookHmac(req, res, next);

    expect(prisma.tenant.findFirst).toHaveBeenCalledWith({ where: { waPhoneId: 'unknown-phone' } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts valid signed webhook and injects tenant/config', async () => {
    const secret = 'meta-secret-123';
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'phone-1' } } }] }]
    });

    const signature =
      'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    const tenant = { id: 't1', name: 'Tenant 1', waPhoneId: 'phone-1' };
    const config = { tenantId: 't1', metaAppSecret: secret };

    prisma.tenant.findFirst.mockResolvedValue(tenant);
    prisma.configuration.findUnique.mockResolvedValue(config);

    const req = {
      headers: { 'x-hub-signature-256': signature },
      rawBody: body
    };
    const res = buildRes();
    const next = jest.fn();

    await validateWebhookHmac(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenant).toEqual(tenant);
    expect(req.webhookConfig).toEqual(config);
  });
});
