/**
 * Middleware de tratamento de erros centralizado
 *
 * - Em PRODUÇÃO: Retorna mensagens genéricas, logs detalhados no servidor
 * - Em DESENVOLVIMENTO: Retorna detalhes completos do erro
 */

const logger = require('../utils/logger');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Erros conhecidos com códigos HTTP apropriados
 */
const knownErrors = {
  ValidationError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  RateLimitError: 429
};

/**
 * Mensagens genéricas para produção (não expõem detalhes)
 */
const productionMessages = {
  400: 'Dados inválidos na requisição',
  401: 'Credenciais inválidas ou sessão expirada',
  403: 'Acesso não autorizado',
  404: 'Recurso não encontrado',
  409: 'Conflito de dados',
  429: 'Muitas requisições. Aguarde um momento.',
  500: 'Erro interno do servidor'
};

/**
 * Erro customizado para validação
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

/**
 * Erro customizado para não autorizado
 */
class UnauthorizedError extends Error {
  constructor(message = 'Não autorizado') {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 401;
  }
}

/**
 * Erro customizado para proibido
 */
class ForbiddenError extends Error {
  constructor(message = 'Acesso proibido') {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
  }
}

/**
 * Erro customizado para não encontrado
 */
class NotFoundError extends Error {
  constructor(message = 'Recurso não encontrado') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

/**
 * Middleware de tratamento de erros
 */
function errorHandler(err, req, res, next) {
  // Determina o código de status
  const statusCode = err.statusCode || knownErrors[err.name] || 500;

  // Log detalhado no servidor (sempre)
  logger.error(`${req.method} ${req.path}`, err);

  // Resposta ao cliente
  if (isProduction) {
    // Em produção: mensagem genérica
    res.status(statusCode).json({
      error: productionMessages[statusCode] || 'Erro interno do servidor',
      code: statusCode
    });
  } else {
    // Em desenvolvimento: detalhes completos
    res.status(statusCode).json({
      error: err.message,
      code: statusCode,
      name: err.name,
      stack: err.stack
    });
  }
}

/**
 * Middleware para rotas não encontradas (404)
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: isProduction
      ? 'Recurso não encontrado'
      : `Rota ${req.method} ${req.path} não encontrada`,
    code: 404
  });
}

/**
 * Wrapper para async handlers (evita try/catch em todos os controllers)
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError
};
