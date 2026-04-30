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

// Schema para atualizar tenant (SuperAdmin)
const UpdateTenantSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .trim()
    .optional(),
  plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  costPerMessage: z
    .number()
    .min(0, 'Custo não pode ser negativo')
    .max(1000, 'Custo máximo é 1000')
    .optional(),
  costPerUser: z
    .number()
    .min(0, 'Custo não pode ser negativo')
    .max(1000, 'Custo máximo é 1000')
    .optional()
});

// Schema para toggle de status do tenant
const ToggleTenantStatusSchema = z.object({
  active: z.boolean().or(z.enum(['true', 'false']).transform((val) => val === 'true'))
});

// Schema para salvar URAs (Unidades de Resposta Automática) - COMPLETO
const SaveURAsSchema = z.object({
  uras: z
    .record(
      z.object({
        nodeId: z.string().min(1).max(50),
        type: z.enum(['text', 'options', 'menu', 'transfer', 'end']),
        message: z.string().min(1).max(1000),
        options: z.record(z.string()).max(10, 'Máximo 10 opções').optional(),
        nextNode: z.string().optional(),
        timeout: z.number().int().min(0).max(300).optional()
      })
    )
    .max(50, 'Máximo 50 fluxos'),
  active: z.union([z.boolean(), z.string()]).transform((val) => val === true || val === 'true')
});

// Schema para salvar pauses (razões de pausa) - COMPLETO
const SavePausesSchema = z.object({
  reasons: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        label: z.string().min(1).max(50),
        durationMinutes: z.number().int().min(1).max(480).optional()
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
  flowTimeout: z.number().int().min(1).max(300).optional()
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

// NEW: Schema para criar agente (Admin)
const CreateAgentSchema = z.object({
  name: z
    .string()
    .min(2, 'Nome deve ter no mínimo 2 caracteres')
    .max(100, 'Nome não pode exceder 100 caracteres')
    .trim(),
  email: z.string().email('Email inválido').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Senha deve ter mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve ter pelo menos 1 maiúscula')
    .regex(/\d/, 'Senha deve ter pelo menos 1 número')
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Senha deve ter pelo menos 1 caractere especial'),
  role: z.enum(['AGENT', 'SUPERVISOR', 'ADMIN']).default('AGENT'),
  skills: z.array(z.string().uuid()).max(20, 'Máximo 20 skills').optional()
});

// NEW: Schema para atualizar agente (Admin)
const UpdateAgentSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .trim()
    .optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/)
    .regex(/\d/)
    .optional(),
  role: z.enum(['AGENT', 'SUPERVISOR', 'ADMIN']).optional(),
  skills: z.array(z.string().uuid()).max(20).optional(),
  active: z.boolean().optional()
});

// NEW: Schema para criar skill (Admin)
const CreateSkillSchema = z.object({
  name: z
    .string()
    .min(2, 'Nome deve ter no mínimo 2 caracteres')
    .max(100, 'Nome não pode exceder 100 caracteres')
    .trim(),
  description: z
    .string()
    .min(0)
    .max(500, 'Descrição não pode exceder 500 caracteres')
    .trim()
    .optional()
});

// NEW: Schema para atualizar settings/configurações (Admin - OWNER)
const UpdateSettingsSchema = z.object({
  maxConcurrentAgents: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional(),
  defaultAgentLanguage: z.string().length(2).optional() // ISO 639-1 (pt, en, es)
});

// NEW: Schema para paginação em admin
const AdminPaginationSchema = z.object({
  page: z
    .union([z.string().regex(/^\d+$/), z.number()])
    .transform((val) => Math.max(1, parseInt(val, 10)))
    .optional()
    .default('1'),
  limit: z
    .union([z.string().regex(/^\d+$/), z.number()])
    .transform((val) => Math.min(Math.max(1, parseInt(val, 10)), 100))
    .optional()
    .default('50'),
  search: z.string().max(100).trim().optional(),
  sort: z.enum(['asc', 'desc']).optional()
});

module.exports = {
  CreateTenantSchema,
  UpdateTenantSchema,
  ToggleTenantStatusSchema,
  SaveURAsSchema,
  SavePausesSchema,
  SaveFlowConfigSchema,
  UpdateAgentConfigSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  CreateSkillSchema,
  UpdateSettingsSchema,
  AdminPaginationSchema
};
