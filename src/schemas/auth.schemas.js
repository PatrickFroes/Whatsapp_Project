/**
 * auth.schemas.js - Validação de autenticação com Zod
 * Valida registro, login, e operações de autenticação
 */

const { z } = require('zod');

// Email validation - RFC 5321
const emailSchema = z.string().email().toLowerCase().trim();

// Senha forte - mín 8 caracteres, 1 maiúscula, 1 número, 1 especial
const passwordSchema = z
  .string()
  .min(8, 'Senha deve ter mínimo 8 caracteres')
  .regex(/[A-Z]/, 'Senha deve ter pelo menos 1 maiúscula')
  .regex(/\d/, 'Senha deve ter pelo menos 1 número')
  .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Senha deve ter pelo menos 1 caractere especial');

// Registro - cria novo usuário
const RegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  passwordConfirm: z.string(),
  name: z.string().min(2).max(100),
  tenantName: z.string().min(2).max(100).optional()
});

// Login - apenas email e senha
const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Senha é obrigatória')
});

// Refresh token
const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Token é obrigatório')
});

// Password reset request
const PasswordResetRequestSchema = z.object({
  email: emailSchema
});

// Password reset confirm
const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema
});

// Change password (logged in user)
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
  newPasswordConfirm: z.string()
});

// Validate registra - adiciona validação custom
const validateRegister = (data) => {
  const result = RegisterSchema.safeParse(data);
  if (!result.success) {
    return { valid: false, errors: result.error.flatten() };
  }
  // Verifica se senhas conferem
  if (data.password !== data.passwordConfirm) {
    return { valid: false, errors: { fieldErrors: { passwordConfirm: ['Senhas não conferem'] } } };
  }
  return { valid: true, data: result.data };
};

module.exports = {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  PasswordResetRequestSchema,
  PasswordResetConfirmSchema,
  ChangePasswordSchema,
  validateRegister
};
