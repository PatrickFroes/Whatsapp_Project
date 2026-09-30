/**
 * admin.schemas.js - Validação Zod para endpoints administrativos
 */

const { z } = require('zod');

// Helper to normalize and map plan names to uppercase enums
const planPreprocess = (val) => {
  if (typeof val !== 'string') {return val;}
  const upper = val.toUpperCase().trim();
  if (upper === 'PRO') {return 'PROFESSIONAL';}
  return upper;
};

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
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens')
    .transform((val) => val.toLowerCase()),
  email: z.string().email('Email inválido').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Senha deve ter mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve ter pelo menos 1 maiúscula')
    .regex(/\d/, 'Senha deve ter pelo menos 1 número')
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Senha deve ter pelo menos 1 caractere especial'),
  plan: z
    .preprocess(planPreprocess, z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']))
    .default('STARTER'),
  
  // Limites Quantitativos (Modular)
  limitMaxAgents: z.number().int().min(1).default(5),
  limitMaxSupervisors: z.number().int().min(0).default(1),
  limitMaxAdmins: z.number().int().min(1).default(1),
  limitWhatsappConnections: z.number().int().min(1).default(1),
  limitStorageDays: z.number().int().min(0).default(30),
  limitStorageGb: z.number().min(0.1).default(2.0),
  limitActiveCampaigns: z.number().int().min(1).default(1),
  limitMonthlyOutboundChats: z.number().int().min(0).default(100),

  // Limites Qualitativos (Ativacoes)
  featureBotBuilder: z.boolean().default(true),
  featureSurvey: z.boolean().default(false),
  featureApiAccess: z.boolean().default(false),
  featureAiSummary: z.boolean().default(false),
  featureQueueAlert: z.boolean().default(false),
  featureCloseWebhook: z.boolean().default(false),
  featureWebchat: z.boolean().default(false)
});

// Schema para atualizar tenant (SuperAdmin)
const UpdateTenantSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .trim()
    .optional(),
  plan: z
    .preprocess(planPreprocess, z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']))
    .optional(),
  costPerMessage: z
    .number()
    .min(0, 'Custo não pode ser negativo')
    .max(1000, 'Custo máximo é 1000')
    .optional(),
  costPerUser: z
    .number()
    .min(0, 'Custo não pode ser negativo')
    .max(1000, 'Custo máximo é 1000')
    .optional(),

  // Limites Quantitativos (Opcionais na Atualização)
  limitMaxAgents: z.number().int().min(1).optional(),
  limitMaxSupervisors: z.number().int().min(0).optional(),
  limitMaxAdmins: z.number().int().min(1).optional(),
  limitWhatsappConnections: z.number().int().min(1).optional(),
  limitStorageDays: z.number().int().min(0).optional(),
  limitStorageGb: z.number().min(0.1).optional(),
  limitActiveCampaigns: z.number().int().min(1).optional(),
  limitMonthlyOutboundChats: z.number().int().min(0).optional(),

  // Limites Qualitativos (Opcionais na Atualização)
  featureBotBuilder: z.boolean().optional(),
  featureSurvey: z.boolean().optional(),
  featureApiAccess: z.boolean().optional(),
  featureAiSummary: z.boolean().optional(),
  featureQueueAlert: z.boolean().optional(),
  featureCloseWebhook: z.boolean().optional(),
  featureWebchat: z.boolean().optional()
});

// Schema para toggle de status do tenant
const ToggleTenantStatusSchema = z.object({
  active: z.boolean().or(z.enum(['true', 'false']).transform((val) => val === 'true'))
});

// Schema para salvar URAs (Unidades de Resposta Automática) - COMPLETO
const SaveURAsSchema = z.object({
  uras: z
    .record(
      z.record(
        z.object({
          type: z.enum([
            'text',
            'auto',
            'menu',
            'collect_data',
            'conditional',
            'math_operation',
            'transfer_agent',
            'transfer',
            'transfer_queue',
            'switch_flow',
            'api_call',
            'set_data',
            'end'
          ]),
          message: z.string().max(1000).optional().nullable(),
          options: z
            .record(z.string())
            .refine((val) => Object.keys(val).length <= 10, 'Máximo 10 opções')
            .optional(),
          timeout: z.number().int().min(0).max(300).optional()
        }).passthrough()
      )
    )
    .refine((val) => Object.keys(val).length <= 50, 'Máximo 50 fluxos'),
  active: z.string().min(1).max(50),
  timeRouting: z.object({
    enabled: z.boolean(),
    rules: z.array(z.object({
      flowId: z.string(),
      start: z.string(),
      end: z.string()
    }))
  }).optional()
});

// Schema para salvar pauses (razões de pausa) - COMPLETO
const SavePausesSchema = z.object({
  list: z
    .array(
      z.object({
        label: z.string().min(1, 'Label do motivo é obrigatório').max(50, 'Label muito longo').trim(),
        maxMinutes: z.number().int().min(0, 'Tempo mínimo é 0').max(480, 'Tempo máximo é 480').nullable().optional()
      })
    )
    .min(1, 'Deve ter pelo menos uma razão de pausa')
    .max(20, 'Máximo 20 razões de pausa')
});

// Schema para salvar encerramentos (razões de tabulação)
const SaveDispositionsSchema = z.object({
  list: z
    .array(
      z.object({
        label: z.string().min(1, 'Label do motivo é obrigatório').max(50, 'Label muito longo').trim()
      })
    )
    .min(1, 'Deve ter pelo menos uma razão de encerramento')
    .max(20, 'Máximo 20 razões de encerramento')
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
  skills: z.array(z.string().uuid()).max(20, 'Máximo 20 skills').optional(),
  maxActiveChats: z.number().int().min(1, 'Mínimo 1 chat').max(100, 'Máximo 100').default(5),
  maxReceivedChats: z.number().int().min(1, 'Mínimo 1 chat').max(100, 'Máximo 100').default(5)
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
  active: z.boolean().optional(),
  maxActiveChats: z.number().int().min(1).max(100).optional(),
  maxReceivedChats: z.number().int().min(1).max(100).optional()
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
  defaultAgentLanguage: z.string().length(2).optional(), // ISO 639-1 (pt, en, es)
  inboundTimeoutMinutes: z
    .number()
    .int()
    .min(1)
    .optional(),
  surveyEnabled: z.boolean().optional(),
  surveyFlowId: z.string().nullable().optional(),
  queueAlertConfig: z.object({
    enabled: z.boolean(),
    maxWaitMinutes: z.number().int().min(1).max(1440),
    notificationType: z.enum(['EMAIL', 'WEBHOOK']),
    target: z.string().trim().min(1)
  }).nullable().optional(),
  closeWebhookConfig: z.object({
    enabled: z.boolean(),
    url: z.string().trim().optional().nullable(),
    secretToken: z.string().trim().optional().nullable()
  }).nullable().optional()
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
  SaveDispositionsSchema,
  SaveFlowConfigSchema,
  UpdateAgentConfigSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  CreateSkillSchema,
  UpdateSettingsSchema,
  AdminPaginationSchema
};
