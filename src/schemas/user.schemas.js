/**
 * user.schemas.js - Validação de Usuário com Zod
 */

const { z } = require('zod');

// Create user (admin only)
const UserCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).optional(),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'AGENT']).optional(),
  skills: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

// Update user
const UserUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'AGENT']).optional(),
  skills: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

// Set user skills
const UserSkillsSchema = z.object({
  userId: z.string().min(1),
  skills: z.array(z.string().min(1))
});

// Agent status
const AgentStatusSchema = z.object({
  status: z.enum(['ONLINE', 'BUSY', 'UNAVAILABLE']),
  pauseReason: z.string().optional(),
  customMessage: z.string().optional()
});

module.exports = {
  UserCreateSchema,
  UserUpdateSchema,
  UserSkillsSchema,
  AgentStatusSchema
};
