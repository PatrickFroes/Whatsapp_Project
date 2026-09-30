'use strict';
/**
 * media.schemas.js — Validação Zod para endpoints de mídia
 */
const { z } = require('zod');

const sendByUrlSchema = z.object({
  phone: z.string().min(7).max(20),
  mediaUrl: z.string().url('URL de mídia inválida').max(2048),
  mediaType: z.enum(['image', 'video', 'audio', 'document'], {
    errorMap: () => ({ message: 'mediaType deve ser: image, video, audio ou document' })
  }),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(255).optional(),
  whatsappPhoneId: z.string().optional(),
  conversationId: z.string().optional()
});

const sendLocationSchema = z.object({
  phone: z.string().min(7).max(20),
  latitude: z.number({ invalid_type_error: 'latitude deve ser um número' }).min(-90).max(90),
  longitude: z.number({ invalid_type_error: 'longitude deve ser um número' }).min(-180).max(180),
  name: z.string().max(255).optional(),
  address: z.string().max(255).optional(),
  whatsappPhoneId: z.string().optional(),
  conversationId: z.string().optional()
});

module.exports = { sendByUrlSchema, sendLocationSchema };
