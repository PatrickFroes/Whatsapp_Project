/**
 * Media Routes - Upload e envio de mídias
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const MediaController = require('../controllers/MediaController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { sendByUrlSchema, sendLocationSchema } = require('../schemas/media.schemas');

// Middleware de validação Zod reutilizável
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: result.error.flatten().fieldErrors
    });
  }
  req.body = result.data; // usa dados sanitizados
  next();
};

// Tipos MIME permitidos (compatíveis com a API do WhatsApp Business)
const ALLOWED_MIME_TYPES = new Set([
  // Imagens
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  // Vídeo
  'video/mp4', 'video/3gpp', 'video/quicktime', 'video/webm',
  // Áudio
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/opus', 'audio/mp4',
  // Documentos
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error(`Tipo de arquivo não permitido: ${file.mimetype}`), { status: 400 }), false);
  }
};

// Configurar multer para upload com validação de MIME
const upload = multer({
  dest: './uploads/temp/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  },
  fileFilter
});

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Streaming/Download do binário do arquivo de mídia (autenticado por header ou ?token=...)
router.get('/download/:mediaId', MediaController.downloadMediaFile);

// Upload e envio de mídia
router.post('/upload', upload.single('file'), MediaController.uploadAndSend);

// Obter URL de mídia do WhatsApp
router.get('/url/:mediaId', MediaController.getMediaUrl);

// Enviar mídia por URL (sem upload) — validação de schema + proteção SSRF no controller
router.post('/send-url', validate(sendByUrlSchema), MediaController.sendByUrl);

// Enviar localização — validação de schema
router.post('/location', validate(sendLocationSchema), MediaController.sendLocation);

module.exports = router;
