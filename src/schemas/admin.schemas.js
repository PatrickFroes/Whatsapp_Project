/**
 * admin.schemas.js - Validação Zod para endpoints administrativos
 */

const { z } = require('zod');

// Schema para criar tenant (SuperAdmin)
const CreateTenantSchema = z.object({
  name: z
    .string()
    .min(2, 'Nome do tenant deve ter no mínimo 2 caracteres')
    .max(100, 'Nome do tenant não pode exceder 100 caracteres')
    .trim(),
  slug: z
    .string()
    .min(2, 'Slug deve ter no mínimo 2 caracteres')
    .max(50, 'Slug não pode exceder 50 caracteres')
    .regex(/^[a-z0-9\-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens')
    .transform((val) => val.toLowerCase()),
  email: z.string().email('Email inválido').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Senha deve ter mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve ter pelo menos 1 maiúscula')
    .regex(/\d/, 'Senha deve ter pelo menos 1 número')
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Senha deve ter pelo menos 1 caractere especial'),
  plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']).default('STARTER')
});

// Schema para salvar URAs (Unidades de Resposta Automática)
const SaveURAsSchema = z.object({
  uras: z.record(z.any()).refine(
    (data) => Object.keys(data).length > 0,
    'URAs object cannot be empty'
  ),
  active: z.union([z.boolean(), z.string()]).transform((val) => val === true || val === 'true')
});

// Schema para salvar pauses (razões de pausa)
const SavePausesSchema = z.object({
  reasons: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(50),
        durationMinutes: z.number().int().min(1).max(480).optional() // até 8 horas
      })
    )
    .min(1, 'Deve ter pelo menos uma razão de pausa')
    .max(20, 'Máximo 20 razões de pausa')
});

// Schema para salvar configurações de fluxo
const SaveFlowConfigSchema = z.object({
  defaultFlow: z.string().optional(),
  fallbackFlow: z.string().optional(),
  enableCustomFlow: z.boolean().default(false),
  flowTimeout: z.number().int().min(1).max(300).optional() // até 5 minutos
});

// Schema para atualizar configurações de agente
const UpdateAgentConfigSchema = z.object({
  maxConcurrentChats: z
    .number()
    .int()
    .min(1, 'Mínimo 1 chat')
    .max(50, 'Máximo 50 chats simultâneos')
    .optional(),
  maxQueueWaitTime: z
    .number()
    .int()
    .min(1, 'Mínimo 1 minuto')
    .max(120, 'Máximo 120 minutos')
    .optional(),
  allowAutoAssign: z.boolean().optional(),
  enablePerformanceTracking: z.boolean().optional()
});

module.exports = {
  CreateTenantSchema,
  SaveURAsSchema,
  SavePausesSchema,
  SaveFlowConfigSchema,
  UpdateAgentConfigSchema
};
