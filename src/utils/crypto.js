const crypto = require('crypto');
const logger = require('./logger');

const algorithm = 'aes-256-cbc';

// Gera uma chave simétrica determinística a partir do JWT_SECRET
let key;
try {
  const secret = process.env.JWT_SECRET || 'fallback-broker-encryption-secret-key-32';
  key = crypto.scryptSync(secret, 'broker-salt', 32);
} catch (err) {
  logger.error('[Crypto] Failed to derive key, using fallback', err);
  key = crypto.scryptSync('fallback-broker-encryption-secret-key-32', 'broker-salt', 32);
}

/**
 * Criptografa um texto usando AES-256-CBC
 * @param {string} text 
 * @returns {string}
 */
function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // Concatena o IV (sempre 32 caracteres em hex) com o texto encriptado sem usar ':'
    return iv.toString('hex') + encrypted;
  } catch (err) {
    logger.error('[Crypto] Encryption error:', err);
    return '';
  }
}

/**
 * Decriptografa um texto encriptado usando AES-256-CBC
 * @param {string} encryptedData 
 * @returns {string|null}
 */
function decrypt(encryptedData) {
  if (!encryptedData || encryptedData.length <= 32) return null;
  try {
    // Como o IV tem sempre 16 bytes (32 caracteres em hexadecimal), o extraímos dos primeiros 32 caracteres
    const ivHex = encryptedData.substring(0, 32);
    const encryptedTextHex = encryptedData.substring(32);
    
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(encryptedTextHex, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // Retorna null silenciosamente se a decriptação falhar
    return null;
  }
}

/**
 * Cria um hash MD5 a partir de uma string
 * @param {string} str 
 * @returns {string}
 */
function hashString(str) {
  return crypto.createHash('md5').update(str || '').digest('hex');
}

/**
 * Verifica se dois IPs são compatíveis, tolerando pequenas variações de sub-rede
 * e confiando em conexões locais vindas do proxy reverso do Nginx no Docker.
 * @param {string} ipA 
 * @param {string} ipB 
 * @returns {boolean}
 */
function isIpCompatible(ipA, ipB) {
  if (!ipA || !ipB) return false;
  if (ipA === ipB) return true;

  // Verifica se o IP é de loopback, rede privada ou rede interna do Docker (172.16.x.x, 10.x.x.x, 192.168.x.x)
  const isPrivateOrLocal = (ip) => {
    return ip.startsWith('127.') || 
           ip.startsWith('172.') || 
           ip.startsWith('192.168.') || 
           ip.startsWith('10.') || 
           ip === '::1' || 
           ip.startsWith('::ffff:127.') ||
           ip.startsWith('::ffff:172.') ||
           ip.startsWith('::ffff:192.168.') ||
           ip.startsWith('::ffff:10.');
  };

  // Se o IP atual (ipB) for local/interno do container/proxy reverso, confiamos nele
  if (isPrivateOrLocal(ipB)) {
    return true;
  }

  // Normaliza o IP IPv4 mapeado em IPv6 (remove o prefixo ::ffff:)
  const cleanIp = (ip) => {
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    return ip;
  };

  const a = cleanIp(ipA);
  const b = cleanIp(ipB);

  // Compara os dois primeiros blocos (octetos) no IPv4
  const partsA = a.split('.');
  const partsB = b.split('.');
  if (partsA.length >= 2 && partsB.length >= 2) {
    return partsA[0] === partsB[0] && partsA[1] === partsB[1];
  }

  // Compara os dois primeiros blocos no IPv6
  const partsA6 = a.split(':');
  const partsB6 = b.split(':');
  if (partsA6.length >= 2 && partsB6.length >= 2) {
    return partsA6[0] === partsB6[0] && partsA6[1] === partsB6[1];
  }

  return false;
}

module.exports = { encrypt, decrypt, hashString, isIpCompatible };
