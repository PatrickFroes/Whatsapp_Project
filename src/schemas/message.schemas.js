/**
 * message.schemas.js - Validação de Mensagens com Zod
 */

const { z } = require('zod');

// Text message
const TextMessageSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4096),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'video', 'audio', 'document']).optional()
});

// Buttons template
const ButtonTemplateSchema = z.object({
  text: z.string().max(1024),
  buttons: z.array(
    z.object({
      type: z.enum(['reply', 'url', 'phone_number']),
      title: z.string().max(20),
      id: z.string().optional(),
      url: z.string().url().optional(),
      phone_number: z.string().optional()
    })
  )
});

// Interactive message
const InteractiveMessageSchema = z.object({
  conversationId: z.string().min(1),
  type: z.enum(['button', 'list']),
  header: z.string().optional(),
  body: z.string(),
  footer: z.string().optional(),
  options: z.array(z.object({ id: z.string(), title: z.string() }))
});

// Send message request
const SendMessageSchema = z.union([TextMessageSchema, InteractiveMessageSchema]);

// Message status update
const MessageStatusUpdateSchema = z.object({
  messageId: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'read', 'failed', 'pending'])
});

module.exports = {
  TextMessageSchema,
  ButtonTemplateSchema,
  InteractiveMessageSchema,
  SendMessageSchema,
  MessageStatusUpdateSchema
};
