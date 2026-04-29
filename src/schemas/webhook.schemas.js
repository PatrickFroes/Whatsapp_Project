/**
 * webhook.schemas.js - Validação Zod para webhooks Meta/WhatsApp
 */

const { z } = require('zod');

// Schema para validação de entrada de webhook (query parameters)
const WebhookVerifyQuerySchema = z.object({
  'hub.mode': z.enum(['subscribe', 'unsubscribe']),
  'hub.challenge': z.string().min(1),
  'hub.verify_token': z.string().min(1)
});

// Schema para payload de webhook (simplificado para estrutura básica)
const WebhookPayloadSchema = z.object({
  object: z.enum(['whatsapp_business_account', 'page']),
  entry: z
    .array(
      z.object({
        id: z.string(),
        changes: z
          .array(
            z.object({
              value: z.object({
                messaging_product: z.string().optional(),
                metadata: z
                  .object({
                    display_phone_number: z.string().optional(),
                    phone_number_id: z.string(),
                    business_account_id: z.string().optional()
                  })
                  .optional(),
                messages: z
                  .array(
                    z.object({
                      from: z.string(),
                      id: z.string(),
                      timestamp: z.union([z.string(), z.number()]),
                      type: z.enum(['text', 'image', 'document', 'audio', 'video', 'button', 'interactive', 'unknown']),
                      text: z
                        .object({
                          body: z.string().max(5000) // limitar tamanho de mensagem
                        })
                        .optional(),
                      image: z
                        .object({
                          mime_type: z.string(),
                          sha256: z.string(),
                          id: z.string().optional(),
                          link: z.string().url().optional()
                        })
                        .optional(),
                      document: z
                        .object({
                          mime_type: z.string(),
                          sha256: z.string(),
                          id: z.string().optional(),
                          link: z.string().url().optional()
                        })
                        .optional(),
                      context: z.object({}).optional()
                    })
                  )
                  .optional(),
                statuses: z
                  .array(
                    z.object({
                      id: z.string(),
                      status: z.enum(['sent', 'delivered', 'read', 'failed']),
                      timestamp: z.union([z.string(), z.number()]),
                      recipient_id: z.string().optional(),
                      errors: z
                        .array(
                          z.object({
                            code: z.number(),
                            message: z.string()
                          })
                        )
                        .optional()
                    })
                  )
                  .optional()
              })
            })
          )
          .min(1)
      })
    )
    .min(1)
});

// Schema simplificado para validação básica
const WebhookBodySchema = z.object({
  object: z.string(),
  entry: z.array(z.record(z.any())).min(1)
});

module.exports = {
  WebhookVerifyQuerySchema,
  WebhookPayloadSchema,
  WebhookBodySchema
};
