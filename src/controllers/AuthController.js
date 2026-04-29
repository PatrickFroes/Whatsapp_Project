const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../services/database');
const logger = require('../utils/logger');
const { recordFailedLogin, clearLoginAttempts } = require('../middleware/loginRateLimiter');
const {
  validateEmail,
  validatePassword,
  validateString,
  validateSlug
} = require('../utils/validators');

if (!process.env.JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET environment variable is required!');
  process.exit(1);
}

const SECRET_KEY = process.env.JWT_SECRET;

class AuthController {
  static async register(req, res) {
    try {
      const { email, password, name, tenantName, plan } = req.body;

      // Validação robusta usando validators
      let validatedEmail, validatedPassword, validatedName, validatedTenantName;

      try {
        validatedEmail = validateEmail(email);
        validatedPassword = validatePassword(password, { minLength: 8, requireNumbers: true });
        validatedName = validateString(name, 'Nome', {
          minLength: 2,
          maxLength: 100,
          required: false
        });
        validatedTenantName = validateString(tenantName, 'Nome da empresa', {
          minLength: 2,
          maxLength: 100
        });
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({ where: { email: validatedEmail } });
      if (existingUser) {
        return res.status(400).json({ error: 'Usuário já existe' });
      }

      // Hash password OUTSIDE transaction (bcrypt is slow, could timeout)
      const hashedPassword = await bcrypt.hash(validatedPassword, 10);

      // 1. Create Tenant
      // 2. Create User (Owner)
      // Transaction ensures both or nothing
      const result = await prisma.$transaction(async (tx) => {
        const slug = validateSlug(validatedTenantName + '-' + Math.floor(Math.random() * 1000));

        const tenant = await tx.tenant.create({
          data: {
            name: validatedTenantName,
            slug: slug,
            plan: plan || 'free'
          }
        });

        const user = await tx.user.create({
          data: {
            email: validatedEmail,
            password: hashedPassword, // Use pre-hashed password
            name: validatedName || validatedEmail.split('@')[0],
            role: 'OWNER',
            tenantId: tenant.id
          }
        });

        return { tenant, user };
      });

      const token = jwt.sign(
        { userId: result.user.id, tenantId: result.tenant.id, role: result.user.role },
        SECRET_KEY,
        { expiresIn: '24h' }
      );

      // Set auth cookie for server-side page protection
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: true, // obrigatório para SameSite=None
        sameSite: 'None', // permite cross-domain em iframe
        maxAge: 24 * 60 * 60 * 1000, // 24h
        path: '/'
      });

      res.status(201).json({
        message: 'Account created successfully',
        token,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          tenant: {
            id: result.tenant.id,
            name: result.tenant.name
          }
        }
      });
    } catch (error) {
      logger.error('Registration failed', error);
      res.status(500).json({ error: 'Falha no registro' });
    }
  }

  static async login(req, res) {
    try {
      const { email, password } = req.body;

      // Validação básica
      let validatedEmail;
      try {
        validatedEmail = validateEmail(email);
        if (!password) {
          throw new Error('Senha é obrigatória');
        }
      } catch (validationError) {
        // Mensagem genérica para não revelar se email existe
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      logger.info(`[LOGIN DEBUG] Searching for user with email: ${validatedEmail}`);

      const user = await prisma.user.findUnique({
        where: { email: validatedEmail },
        include: { tenant: true }
      });

      if (!user) {
        logger.warn(`[LOGIN DEBUG] User not found: ${validatedEmail}`);
        // Mensagem genérica - não revela se email existe
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      logger.info(`[LOGIN DEBUG] User found: ${user.email}, role: ${user.role}`);

      const isValidValues = await bcrypt.compare(password, user.password);
      logger.info(`[LOGIN DEBUG] Password comparison result: ${isValidValues}`);

      if (!isValidValues) {
        logger.warn(`[LOGIN DEBUG] Password mismatch for user: ${validatedEmail}`);
        // Registrar tentativa falhada no novo sistema (por device, não por IP)
        await recordFailedLogin(validatedEmail, req.deviceId);
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      if (!user.tenant.active) {
        return res.status(403).json({ error: 'Conta do tenant está inativa' });
      }

      // Update last login / availability ?
      // await prisma.user.update(...)
      
      // Limpar tentativas falhadas pois o login foi bem-sucedido
      await clearLoginAttempts(validatedEmail, req.deviceId);

      const token = jwt.sign(
        { userId: user.id, tenantId: user.tenantId, role: user.role },
        SECRET_KEY,
        { expiresIn: '24h' }
      );

      // Set auth cookie for server-side page protection
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 24 * 60 * 60 * 1000, // 24h
        path: '/'
      });

      // Determine redirect based on role
      let redirect = '/agent.html'; // Default
      if (user.role === 'SUPER_ADMIN') {
        redirect = '/super.html';
      } else if (user.role === 'ADMIN' || user.role === 'OWNER') {
        redirect = '/admin.html';
      } else if (user.role === 'SUPERVISOR') {
        redirect = '/supervisor.html';
      }

      res.json({
        message: 'Login successful',
        token,
        redirect,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          workStatus: user.workStatus
        }
      });
    } catch (error) {
      logger.error('Login failed', error);
      res.status(500).json({ error: 'Falha no login' });
    }
  }

  static async me(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        include: { tenant: true, skills: { include: { skill: true } } }
      });

      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      // Sanitize - remove campos sensíveis
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      logger.error('Error fetching profile', error);
      res.status(500).json({ error: 'Erro ao buscar perfil' });
    }
  }

  static async logout(req, res) {
    // Clear auth cookie
    res.clearCookie('auth_token', { path: '/' });
    res.json({ message: 'Logout successful' });
  }
}

module.exports = AuthController;
