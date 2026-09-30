/**
 * configuration.schemas.js - Validação Zod para configurações
 */

const z = require('zod');

// Validação para salvar configuração
// IMPORTANTE: Campos podem ser null/undefined (não está editando)
// Mas se vêm preenchidos, devem ser válidos
// Pelo menos UM campo de credencial deve ser fornecido
const SaveConfigurationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Name cannot be empty').optional(),
  status: z.enum(['CONNECTED', 'ERROR', 'DISCONNECTED']).optional(),
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
    .optional(),

  wabaId: z
    .union([
      z
        .string()
        .min(1, 'WABA ID cannot be empty')
        .regex(/^\d+$/, 'WABA ID must contain only digits'),
      z.null(),
      z.undefined()
    ])
    .optional()
})
.refine(
  (data) => data.phoneNumberId || data.whatsappToken || data.metaAppSecret || data.verifyToken || data.wabaId,
  { message: 'Must provide at least one credential field' }
);

// Validação para credenciais completas (para uso em serviços)
// Usado antes de chamar APIs Meta
const ValidCredentialsSchema = z.object({
  phoneNumberId: z.string().min(1, 'phoneNumberId is required'),
  whatsappToken: z.string().min(20, 'whatsappToken is required'),
  metaAppSecret: z.string().min(20, 'metaAppSecret is required')
});

// Schemas de resposta (leitura)
const ConfigurationResponseSchema = z.object({
  tenantId: z.string(),
  isConfigured: z.object({
    phoneNumberId: z.boolean(),
    verifyToken: z.boolean(),
    whatsappToken: z.boolean(),
    metaAppSecret: z.boolean(),
    wabaId: z.boolean(),
    allRequired: z.boolean()
  }),
  updatedAt: z.date().optional(),
  updatedBy: z.string().optional()
});

module.exports = {
  SaveConfigurationSchema,
  ConfigurationResponseSchema,
  ValidCredentialsSchema
};
