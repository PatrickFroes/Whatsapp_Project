/**
 * configuration.schemas.js - Validação Zod para configurações
 */

const z = require('zod');

// Validação para salvar configuração
// IMPORTANTE: Campos podem ser null/undefined (não está editando)
// Mas se vêm preenchidos, devem ser válidos
const SaveConfigurationSchema = z.object({
  phoneNumberId: z
    .union([
      z
        .string()
        .min(1, 'Phone Number ID cannot be empty')
        .regex(/^\d+$/, 'Phone Number ID must contain only digits'),
      z.null(),
      z.undefined()
    ])
    .optional(),

  verifyToken: z
    .union([
      z.string().min(8, 'Verify Token must be at least 8 characters'),
      z.null(),
      z.undefined()
    ])
    .optional(),

  whatsappToken: z
    .union([
      z.string().min(20, 'WhatsApp Token must be at least 20 characters'),
      z.null(),
      z.undefined()
    ])
    .optional(),

  metaAppSecret: z
    .union([
      z.string().min(20, 'Meta App Secret must be at least 20 characters'),
      z.null(),
      z.undefined()
    ])
    .optional()
});

// Schemas de resposta (leitura)
const ConfigurationResponseSchema = z.object({
  tenantId: z.string(),
  isConfigured: z.object({
    phoneNumberId: z.boolean(),
    verifyToken: z.boolean(),
    whatsappToken: z.boolean(),
    metaAppSecret: z.boolean(),
    allRequired: z.boolean()
  }),
  updatedAt: z.date().optional(),
  updatedBy: z.string().optional()
});

module.exports = {
  SaveConfigurationSchema,
  ConfigurationResponseSchema
};
