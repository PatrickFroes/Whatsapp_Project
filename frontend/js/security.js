/**
 * Funções de segurança para prevenir XSS (Cross-Site Scripting)
 *
 * IMPORTANTE: Este arquivo DEVE ser carregado ANTES de frontend.js e admin.js
 */

/**
 * Escapa caracteres HTML para prevenir XSS
 * Converte caracteres especiais em entidades HTML
 *
 * @param {string} text - Texto a ser escapado
 * @returns {string} Texto seguro para inserção em HTML
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') return String(text);

  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Remove tags HTML de uma string
 * Útil para exibir texto puro sem formatação
 *
 * @param {string} html - HTML a ser limpo
 * @returns {string} Texto sem tags HTML
 */
function stripHtml(html) {
  if (html === null || html === undefined) return '';
  if (typeof html !== 'string') return String(html);

  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

/**
 * Sanitiza URL para prevenir javascript: e data: URIs maliciosos
 *
 * @param {string} url - URL a ser validada
 * @returns {string} URL segura ou string vazia se inválida
 */
function sanitizeUrl(url) {
  if (!url) return '';
  if (typeof url !== 'string') return '';

  const urlLower = url.toLowerCase().trim();

  // Bloquear protocolos perigosos
  if (
    urlLower.startsWith('javascript:') ||
    urlLower.startsWith('data:text/html') ||
    urlLower.startsWith('vbscript:')
  ) {
    console.warn('[Security] URL bloqueada por protocolo perigoso:', url);
    return '';
  }

  return url;
}

/**
 * Valida se uma string é um número de telefone válido
 *
 * @param {string} phone - Número de telefone
 * @returns {boolean} true se válido
 */
function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  // Aceita apenas números e alguns caracteres especiais
  return /^[\d\s\-\+\(\)]+$/.test(phone);
}

/**
 * Valida se uma string é um email válido (básico)
 *
 * @param {string} email - Email
 * @returns {boolean} true se válido
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Exportar para uso global
window.escapeHtml = escapeHtml;
window.stripHtml = stripHtml;
window.sanitizeUrl = sanitizeUrl;
window.isValidPhone = isValidPhone;
window.isValidEmail = isValidEmail;

console.log('[Security] Módulo de segurança carregado ✓');
