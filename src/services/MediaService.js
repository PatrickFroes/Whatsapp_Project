/**
 * MediaService - Upload e processamento de mídias
 * Suporta: imagens, vídeos, documentos, áudios
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);
const prisma = require('./database');

// Configurações de mídia
const MEDIA_CONFIG = {
  image: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp']
  },
  video: {
    maxSize: 16 * 1024 * 1024, // 16MB
    allowedTypes: ['video/mp4', 'video/3gpp'],
    extensions: ['.mp4', '.3gp']
  },
  audio: {
    maxSize: 16 * 1024 * 1024, // 16MB
    allowedTypes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
    extensions: ['.aac', '.m4a', '.mp3', '.amr', '.ogg']
  },
  document: {
    maxSize: 100 * 1024 * 1024, // 100MB
    allowedTypes: [
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ],
    extensions: ['.pdf', '.ppt', '.doc', '.xls', '.docx', '.pptx', '.xlsx', '.txt']
  },
  sticker: {
    maxSize: 100 * 1024, // 100KB
    allowedTypes: ['image/webp'],
    extensions: ['.webp']
  }
};

/**
 * Obtém credenciais de WhatsApp para o tenant
 * @param {Object} tenant - Objeto tenant com id
 * @returns {Object} { phoneNumberId, token, url }
 */
async function getCredentials(tenant) {
  if (!tenant || !tenant.id) {
    throw new Error('Invalid tenant object');
  }

  try {
    const config = await prisma.configuration.findUnique({
      where: { tenantId: tenant.id }
    });

    if (!config || !config.whatsappToken || !config.phoneNumberId) {
      throw new Error(`Missing WhatsApp credentials for tenant: ${tenant.id}`);
    }

    return {
      phoneNumberId: config.phoneNumberId,
      token: config.whatsappToken,
      url: `https://graph.facebook.com/v18.0/${config.phoneNumberId}`
    };
  } catch (error) {
    console.error('🔍 [MediaService] getCredentials failed:', error.message);
    throw error;
  }
}

class MediaService {
  /**
   * Valida arquivo de mídia
   */
  static validateMedia(file, mediaType) {
    const config = MEDIA_CONFIG[mediaType];

    if (!config) {
      throw new Error(`Invalid media type: ${mediaType}`);
    }

    // Verificar tamanho
    if (file.size > config.maxSize) {
      const maxMB = (config.maxSize / (1024 * 1024)).toFixed(0);
      throw new Error(`File too large. Max size: ${maxMB}MB`);
    }

    // Verificar tipo MIME
    if (!config.allowedTypes.includes(file.mimetype)) {
      throw new Error(`Invalid file type. Allowed: ${config.allowedTypes.join(', ')}`);
    }

    // Verificar extensão
    const ext = path.extname(file.originalname).toLowerCase();
    if (!config.extensions.includes(ext)) {
      throw new Error(`Invalid file extension. Allowed: ${config.extensions.join(', ')}`);
    }

    return true;
  }

  /**
   * Detecta tipo de mídia pelo MIME type
   */
  static detectMediaType(mimetype) {
    if (mimetype.startsWith('image/')) {
      return mimetype === 'image/webp' && mimetype.includes('sticker') ? 'sticker' : 'image';
    }
    if (mimetype.startsWith('video/')) {
      return 'video';
    }
    if (mimetype.startsWith('audio/')) {
      return 'audio';
    }
    if (mimetype.startsWith('application/') || mimetype.startsWith('text/')) {
      return 'document';
    }

    return 'document'; // fallback
  }

  /**
   * Faz upload de mídia para WhatsApp Business API
   * @param {Object} file - Arquivo (Express multer)
   * @param {Object} tenant - Tenant object com id
   * @returns {Object} { mediaId, mediaType }
   */
  static async uploadToWhatsApp(file, tenant) {
    const mediaType = this.detectMediaType(file.mimetype);

    // Validar
    this.validateMedia(file, mediaType);

    try {
      const credentials = await getCredentials(tenant);
      const uploadUrl = `${credentials.url}/${credentials.phoneNumberId}/media`;

      // Criar form data
      const formData = new FormData();
      formData.append('file', fs.createReadStream(file.path), {
        filename: file.originalname,
        contentType: file.mimetype
      });
      formData.append('type', file.mimetype);
      formData.append('messaging_product', 'whatsapp');

      // Upload
      console.log(`🔍 [MediaService] Uploading media for tenant: ${tenant.id}, phoneNumberId: ${credentials.phoneNumberId}`);
      const response = await axios.post(uploadUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${credentials.token}`
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      // Limpar arquivo temporário
      if (file.path) {
        await unlinkAsync(file.path).catch((err) =>
          console.warn('Failed to delete temp file:', err)
        );
      }

      return {
        mediaId: response.data.id,
        mediaType,
        mediaSize: file.size,
        mediaMimeType: file.mimetype,
        mediaFilename: file.originalname
      };
    } catch (error) {
      // Limpar arquivo em caso de erro
      if (file.path) {
        await unlinkAsync(file.path).catch(() => {});
      }

      console.error('WhatsApp media upload failed:', error.response?.data || error.message);
      throw new Error('Failed to upload media to WhatsApp');
    }
  }

  /**
   * Baixa mídia da API do WhatsApp
   * @param {String} mediaId - WhatsApp Media ID
   * @param {Object} tenant - Tenant object com id
   * @returns {Object} { url, mimeType, sha256, fileSize }
   */
  static async downloadFromWhatsApp(mediaId, tenant) {
    try {
      const credentials = await getCredentials(tenant);

      // 1. Obter URL da mídia
      const mediaUrl = `https://graph.facebook.com/v18.0/${mediaId}`;
      console.log(`🔍 [MediaService] Downloading media for tenant: ${tenant.id}`);
      const response = await axios.get(mediaUrl, {
        headers: {
          Authorization: `Bearer ${credentials.token}`
        }
      });

      const { url, mime_type, sha256, file_size } = response.data;

      // 2. Baixar arquivo
      const fileResponse = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${credentials.token}`
        },
        responseType: 'arraybuffer'
      });

      return {
        url,
        mimeType: mime_type,
        sha256,
        fileSize: file_size,
        buffer: fileResponse.data
      };
    } catch (error) {
      console.error('WhatsApp media download failed:', error.response?.data || error.message);
      throw new Error('Failed to download media from WhatsApp');
    }
  }

  /**
   * Salva mídia recebida localmente
   * @param {Buffer} buffer - Buffer do arquivo
   * @param {String} filename - Nome do arquivo
   * @param {String} uploadDir - Diretório de upload
   * @returns {String} Caminho do arquivo salvo
   */
  static async saveMediaLocally(buffer, filename, uploadDir = './uploads') {
    // Criar diretório se não existir
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Gerar nome único
    const timestamp = Date.now();
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    const uniqueFilename = `${name}_${timestamp}${ext}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    // Salvar
    await promisify(fs.writeFile)(filePath, buffer);

    return filePath;
  }

  /**
   * Envia mensagem com mídia via WhatsApp
   * @param {String} to - Número do destinatário
   * @param {String} mediaId - WhatsApp Media ID
   * @param {String} mediaType - Tipo (image, video, audio, document)
   * @param {Object} options - Opções adicionais { caption, filename }
   * @param {Object} tenant - Tenant object com id
   * @returns {Object} Resposta da API
   */
  static async sendMediaMessage(to, mediaId, mediaType, options = {}, tenant) {
    const { caption, filename } = options;

    try {
      const credentials = await getCredentials(tenant);
      const messageUrl = `${credentials.url}/${credentials.phoneNumberId}/messages`;

      // Montar payload baseado no tipo
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: mediaType,
        [mediaType]: {
          id: mediaId
        }
      };

      // Adicionar caption (image, video, document)
      if (caption && ['image', 'video', 'document'].includes(mediaType)) {
        payload[mediaType].caption = caption;
      }

      // Adicionar filename (document)
      if (filename && mediaType === 'document') {
        payload[mediaType].filename = filename;
      }

      console.log(`🔍 [MediaService] Sending media message for tenant: ${tenant.id}, phoneNumberId: ${credentials.phoneNumberId}`);
      const response = await axios.post(messageUrl, payload, {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('WhatsApp send media failed:', error.response?.data || error.message);
      throw new Error('Failed to send media message');
    }
  }

  /**
   * Envia mensagem com URL de mídia (sem upload)
   * @param {String} to - Número do destinatário
   * @param {String} mediaUrl - URL pública da mídia
   * @param {String} mediaType - Tipo (image, video, audio, document)
   * @param {Object} options - Opções adicionais
   * @param {Object} tenant - Tenant object com id
   */
  static async sendMediaByUrl(to, mediaUrl, mediaType, options = {}, tenant) {
    const { caption, filename } = options;

    try {
      const credentials = await getCredentials(tenant);
      const messageUrl = `${credentials.url}/${credentials.phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: mediaType,
        [mediaType]: {
          link: mediaUrl
        }
      };

      if (caption && ['image', 'video', 'document'].includes(mediaType)) {
        payload[mediaType].caption = caption;
      }

      if (filename && mediaType === 'document') {
        payload[mediaType].filename = filename;
      }

      console.log(`🔍 [MediaService] Sending media by URL for tenant: ${tenant.id}, phoneNumberId: ${credentials.phoneNumberId}`);
      const response = await axios.post(messageUrl, payload, {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('WhatsApp send media by URL failed:', error.response?.data || error.message);
      throw new Error('Failed to send media message by URL');
    }
  }

  /**
   * Envia localização
   * @param {String} to - Número do destinatário
   * @param {Number} latitude - Latitude
   * @param {Number} longitude - Longitude
   * @param {Object} options - Opções { name, address }
   * @param {Object} tenant - Tenant object com id
   */
  static async sendLocation(to, latitude, longitude, options = {}, tenant) {
    const { name, address } = options;

    try {
      const credentials = await getCredentials(tenant);
      const messageUrl = `${credentials.url}/${credentials.phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'location',
        location: {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude)
        }
      };

      if (name) {
        payload.location.name = name;
      }
      if (address) {
        payload.location.address = address;
      }

      console.log(`🔍 [MediaService] Sending location for tenant: ${tenant.id}, phoneNumberId: ${credentials.phoneNumberId}`);
      const response = await axios.post(messageUrl, payload, {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('WhatsApp send location failed:', error.response?.data || error.message);
      throw new Error('Failed to send location message');
    }
  }
}

module.exports = MediaService;
