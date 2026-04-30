/**
 * tenant.schemas.js - Validação de Tenant/Organização com Zod
 */

const { z } = require('zod');

// Tenant - criação básica por Super Admin
// Credenciais Meta são gerenciadas separadamente via Configuration table
const TenantCreateSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  businessHours: z
    .object({
      enabled: z.boolean(),
      timezone: z.string().optional(),
      days: z.record(z.array(z.string())).optional()
    })
    .optional()
});

// Update tenant
const TenantUpdateSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    businessHours: z.object({}).optional()
  })
  .strict();

// Settings update
const TenantSettingsSchema = z.object({
  name: z.string().optional()
});

module.exports = {
  TenantCreateSchema,
  TenantUpdateSchema,
  TenantSettingsSchema
};
