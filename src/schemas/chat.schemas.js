/**
 * chat.schemas.js - Validação Zod para endpoints de chat
 */

const { z } = require('zod');

// Schema para listar chats - validação de query parameters
const ListChatsQuerySchema = z.object({
  status: z
    .enum(['QUEUED', 'BOT', 'ASSIGNED', 'RESOLVED', 'CLOSED'])
    .optional(),
  mode: z.enum(['my', 'queue', 'all']).optional(),
  page: z
    .union([z.string().regex(/^\d+$/), z.number()])
    .transform((val) => Math.max(1, parseInt(val, 10)))
    .optional()
    .default('1'),
  limit: z
    .union([z.string().regex(/^\d+$/), z.number()])
    .transform((val) => Math.min(Math.max(1, parseInt(val, 10)), 100)) // max 100 por página
    .optional()
    .default('50')
});

// Schema para enviar mensagem
const SendMessageSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID é obrigatório'),
  message: z
    .string()
    .min(1, 'Mensagem não pode estar vazia')
    .max(5000, 'Mensagem não pode exceder 5000 caracteres')
    .trim(),
  type: z.enum(['text', 'image', 'document', 'audio']).default('text'),
  media: z
    .object({
      url: z.string().url(),
      mimeType: z.string().optional()
    })
    .optional()
});

// Schema para atualizar status do chat
const UpdateChatStatusSchema = z.object({
  conversationId: z.string().min(1),
  status: z.enum(['QUEUED', 'BOT', 'ASSIGNED', 'RESOLVED', 'CLOSED']),
  reason: z.string().max(200).optional()
});

// Schema para transferir chat
const TransferChatSchema = z.object({
  conversationId: z.string().min(1),
  targetAgentId: z.string().min(1),
  note: z.string().max(200).optional()
});

module.exports = {
  ListChatsQuerySchema,
  SendMessageSchema,
  UpdateChatStatusSchema,
  TransferChatSchema
};
