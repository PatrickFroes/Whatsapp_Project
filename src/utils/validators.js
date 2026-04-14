/**
 * Validador Robusto de Inputs
 *
 * Funções de validação para sanitizar e validar dados de entrada
 */

const { ValidationError } = require('../middleware/errorHandler');

/**
 * Valida e sanitiza email
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new ValidationError('Email é obrigatório');
  }

  const sanitized = email.trim().toLowerCase();
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!regex.test(sanitized)) {
    throw new ValidationError('Formato de email inválido');
  }

  if (sanitized.length > 255) {
    throw new ValidationError('Email muito longo');
  }

  return sanitized;
}

/**
 * Valida senha (força mínima)
 */
function validatePassword(password, options = {}) {
  const { minLength = 8, requireNumbers = true, requireSpecial = false } = options;

  if (!password || typeof password !== 'string') {
    throw new ValidationError('Senha é obrigatória');
  }

  if (password.length < minLength) {
    throw new ValidationError(`Senha deve ter no mínimo ${minLength} caracteres`);
  }

  if (password.length > 128) {
    throw new ValidationError('Senha muito longa');
  }

  if (requireNumbers && !/\d/.test(password)) {
    throw new ValidationError('Senha deve conter pelo menos um número');
  }

  if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    throw new ValidationError('Senha deve conter pelo menos um caractere especial');
  }

  return password;
}

/**
 * Valida e sanitiza string genérica
 */
function validateString(value, fieldName, options = {}) {
  const { minLength = 0, maxLength = 1000, required = true, trim = true } = options;

  if (!value && required) {
    throw new ValidationError(`${fieldName} é obrigatório`);
  }

  if (!value) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} deve ser texto`);
  }

  let sanitized = trim ? value.trim() : value;

  // Remove caracteres de controle potencialmente perigosos
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  if (sanitized.length < minLength) {
    throw new ValidationError(`${fieldName} deve ter no mínimo ${minLength} caracteres`);
  }

  if (sanitized.length > maxLength) {
    throw new ValidationError(`${fieldName} deve ter no máximo ${maxLength} caracteres`);
  }

  return sanitized;
}

/**
 * Valida número de telefone (formato BR ou internacional)
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    throw new ValidationError('Telefone é obrigatório');
  }

  // Remove tudo exceto números
  const cleaned = phone.replace(/\D/g, '');

  // Telefone BR: 11 dígitos (com DDD) ou 13 (com código país)
  if (cleaned.length < 10 || cleaned.length > 15) {
    throw new ValidationError('Formato de telefone inválido');
  }

  return cleaned;
}

/**
 * Valida UUID
 */
function validateUUID(uuid, fieldName = 'ID') {
  if (!uuid || typeof uuid !== 'string') {
    throw new ValidationError(`${fieldName} é obrigatório`);
  }

  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!regex.test(uuid)) {
    throw new ValidationError(`${fieldName} possui formato inválido`);
  }

  return uuid.toLowerCase();
}

/**
 * Valida enum (valor deve estar na lista)
 */
function validateEnum(value, allowedValues, fieldName) {
  if (!value) {
    throw new ValidationError(`${fieldName} é obrigatório`);
  }

  const normalized = String(value).toUpperCase();

  if (!allowedValues.map((v) => v.toUpperCase()).includes(normalized)) {
    throw new ValidationError(`${fieldName} deve ser um dos valores: ${allowedValues.join(', ')}`);
  }

  return normalized;
}

/**
 * Valida número inteiro
 */
function validateInteger(value, fieldName, options = {}) {
  const { min = null, max = null, required = true } = options;

  if (value === null || value === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} é obrigatório`);
    }
    return null;
  }

  const num = parseInt(value, 10);

  if (isNaN(num)) {
    throw new ValidationError(`${fieldName} deve ser um número inteiro`);
  }

  if (min !== null && num < min) {
    throw new ValidationError(`${fieldName} deve ser no mínimo ${min}`);
  }

  if (max !== null && num > max) {
    throw new ValidationError(`${fieldName} deve ser no máximo ${max}`);
  }

  return num;
}

/**
 * Valida e sanitiza slug (URL-friendly)
 */
function validateSlug(slug, fieldName = 'Slug') {
  if (!slug || typeof slug !== 'string') {
    throw new ValidationError(`${fieldName} é obrigatório`);
  }

  // Converte para lowercase e remove espaços
  let sanitized = slug.toLowerCase().trim();

  // Substitui espaços e caracteres especiais por hífens
  sanitized = sanitized.replace(/[^a-z0-9-]/g, '-');

  // Remove hífens duplicados
  sanitized = sanitized.replace(/-+/g, '-');

  // Remove hífens no início e fim
  sanitized = sanitized.replace(/^-|-$/g, '');

  if (sanitized.length < 2) {
    throw new ValidationError(`${fieldName} deve ter no mínimo 2 caracteres`);
  }

  if (sanitized.length > 50) {
    throw new ValidationError(`${fieldName} deve ter no máximo 50 caracteres`);
  }

  return sanitized;
}

/**
 * Valida JSON
 */
function validateJSON(value, fieldName) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (e) {
    throw new ValidationError(`${fieldName} deve ser um JSON válido`);
  }
}

/**
 * Sanitiza texto para prevenir XSS (server-side)
 */
function sanitizeHtml(text) {
  if (!text) {
    return '';
  }

  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  validateEmail,
  validatePassword,
  validateString,
  validatePhone,
  validateUUID,
  validateEnum,
  validateInteger,
  validateSlug,
  validateJSON,
  sanitizeHtml
};
