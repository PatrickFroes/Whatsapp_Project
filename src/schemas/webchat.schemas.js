/**
 * webchat.schemas.js - Validação Zod para conexões de Webchat
 */

const z = require('zod');

const SaveWebchatConnectionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, 'O nome deve ter pelo menos 2 caracteres').max(100, 'O nome não pode exceder 100 caracteres'),
  status: z.enum(['CONNECTED', 'INACTIVE']).optional(),
  welcomeMessage: z.string().nullable().optional(),
  allowedDomains: z.array(z.string()).optional(),
  flowId: z.union([z.string().uuid(), z.string().length(0), z.null(), z.undefined()]).optional()
});

module.exports = {
  SaveWebchatConnectionSchema
};
