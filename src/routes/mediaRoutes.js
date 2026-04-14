/**
 * Media Routes - Upload e envio de mídias
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const MediaController = require('../controllers/MediaController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Configurar multer para upload
const upload = multer({
  dest: './uploads/temp/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  }
});

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Upload e envio de mídia
router.post('/upload', upload.single('file'), MediaController.uploadAndSend);

// Obter URL de mídia do WhatsApp
router.get('/url/:mediaId', MediaController.getMediaUrl);

// Enviar mídia por URL (sem upload)
router.post('/send-url', MediaController.sendByUrl);

// Enviar localização
router.post('/location', MediaController.sendLocation);

module.exports = router;
