'use strict';
/**
 * ssrfGuard.js — Proteção contra SSRF (Server-Side Request Forgery)
 *
 * Bloqueia requisições direcionadas a endereços de loopback,
 * redes privadas e endpoints de metadados de cloud (AWS/GCP/Azure).
 *
 * Use antes de qualquer fetch/request com URL fornecida pelo usuário.
 */

const { URL } = require('url');

/**
 * Padrões de hostname bloqueados.
 * Inclui loopback, RFC 1918 (redes privadas), link-local (cloud metadata).
 */
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,        // 127.0.0.0/8 loopback
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,           // 10.0.0.0/8  privada
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12 privada
  /^192\.168\.\d{1,3}\.\d{1,3}$/,              // 192.168.0.0/16 privada
  /^169\.254\.\d{1,3}\.\d{1,3}$/,              // 169.254.0.0/16 link-local (AWS metadata)
  /^100\.64\.\d{1,3}\.\d{1,3}$/,               // 100.64.0.0/10 shared address (RFC 6598)
  /^0\.0\.0\.0$/,                               // INADDR_ANY
  /^::1$/,                                      // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,                           // IPv6 ULA (fc00::/7)
  /^fe80:/i,                                    // IPv6 link-local
];

const ALLOWED_SCHEMES = ['https:', 'http:'];

/**
 * Valida uma URL fornecida pelo usuário contra SSRF.
 *
 * @param {string} urlString - URL a validar
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateExternalUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, reason: 'URL não fornecida' };
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: 'URL malformada' };
  }

  // Bloquear protocolos não HTTP/HTTPS (file://, ftp://, etc.)
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return { valid: false, reason: `Protocolo não permitido: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: 'Destino interno não permitido' };
    }
  }

  return { valid: true };
}

module.exports = { validateExternalUrl };
