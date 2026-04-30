const logger = require('../utils/logger');
const prisma = require('../services/database');
const bcrypt = require('bcryptjs');
const { CreateTenantSchema, UpdateTenantSchema, ToggleTenantStatusSchema } = require('../schemas/admin.schemas');
const { logAuditEvent, AuditAction } = require('../services/auditLog.service');

class SuperAdminController {
  // GET /api/super/tenants - List all tenants with pagination
  static async listTenants(req, res) {
    try {
      // Paginação com limites
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
      const skip = (page - 1) * limit;

      logger.info('[SuperAdmin] Listing tenants', {
        page,
        limit,
        userId: req.user.userId
      });

      const [tenants, totalCount] = await Promise.all([
        prisma.tenant.findMany({
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            active: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: { users: true, conversations: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.tenant.count()
      ]);

      res.json({
        tenants,
        pagination: {
          page,
          limit,
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (e) {
      logger.error('[SuperAdmin] listTenants error:', {
        error: e.message,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to list tenants' });
    }
  }

  // POST /api/super/tenants - Create new tenant
  static async createTenant(req, res) {
    try {
      // Validar com Zod schema
      const validation = CreateTenantSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { name, slug, email, password, plan } = validation.data;

      // Verificar slug duplicado
      const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
      if (existingTenant) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { slug: ['Slug already taken'] }
        });
      }

      // Verificar email único globalmente
      const existingUser = await prisma.user.findFirst({
        where: { email }
      });
      if (existingUser) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { email: ['Email already in use'] }
        });
      }

      // Hash password OUTSIDE transaction (bcrypt is slow, could timeout tx)
      const hashedPassword = await bcrypt.hash(password, 10);

      // Transaction: Create Tenant + First Admin User + Configuration Record
      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name,
            slug,
            plan: plan || 'STARTER',
            active: true
          }
        });

        const user = await tx.user.create({
          data: {
            name: `${name} Admin`,
            email,
            password: hashedPassword,
            role: 'OWNER',
            tenantId: tenant.id,
            workStatus: 'AVAILABLE'
          }
        });

        // Create empty Configuration record - admin fills credentials later
        const configuration = await tx.configuration.create({
          data: {
            tenantId: tenant.id,
            phoneNumberId: null,
            verifyToken: null,
            whatsappToken: null,
            metaAppSecret: null,
            updatedBy: user.id
          }
        });

        return { tenant, user, configuration };
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_CREATED, {
        tenantId: result.tenant.id,
        tenantName: name,
        createdBy: req.user.userId,
        plan
      });

      logger.info('[SuperAdmin] Tenant created successfully', {
        tenantId: result.tenant.id,
        name,
        createdBy: req.user.userId
      });

      res.status(201).json(result.tenant);
    } catch (e) {
      logger.error('[SuperAdmin] createTenant error:', {
        error: e.message,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to create tenant' });
    }
  }

  // PUT /api/super/tenants/:id - Update tenant
  static async updateTenant(req, res) {
    try {
      const { id } = req.params;

      // Validar que tenant existe
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, name: true, plan: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Validar input com schema
      const validation = UpdateTenantSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { name, plan, costPerMessage, costPerUser } = validation.data;

      // Preparar dados para atualizar (apenas campos fornecidos)
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (plan !== undefined) updateData.plan = plan;
      if (costPerMessage !== undefined) updateData.costPerMessage = costPerMessage;
      if (costPerUser !== undefined) updateData.costPerUser = costPerUser;

      const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: updateData,
        select: { id: true, name: true, plan: true, active: true, updatedAt: true }
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId: id,
        changes: Object.keys(updateData),
        updatedBy: req.user.userId
      });

      logger.info('[SuperAdmin] Tenant updated', {
        tenantId: id,
        changes: Object.keys(updateData),
        updatedBy: req.user.userId
      });

      res.json(updatedTenant);
    } catch (e) {
      logger.error('[SuperAdmin] updateTenant error:', {
        error: e.message,
        tenantId: req.params.id,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to update tenant' });
    }
  }

  // PUT /api/super/tenants/:id/status - Toggle tenant active status
  static async toggleTenantStatus(req, res) {
    try {
      const { id } = req.params;

      // Validar schema
      const validation = ToggleTenantStatusSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { active } = validation.data;

      // Verificar que tenant existe
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, name: true, active: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Atualizar status
      const updated = await prisma.tenant.update({
        where: { id },
        data: { active },
        select: { id: true, name: true, active: true }
      });

      // Auditoria
      const action = active ? AuditAction.TENANT_ACTIVATED : AuditAction.TENANT_DEACTIVATED;
      await logAuditEvent(action, {
        tenantId: id,
        tenantName: tenant.name,
        deactivatedBy: req.user.userId
      });

      logger.info('[SuperAdmin] Tenant status toggled', {
        tenantId: id,
        active,
        changedBy: req.user.userId
      });

      res.json(updated);
    } catch (e) {
      logger.error('[SuperAdmin] toggleTenantStatus error:', {
        error: e.message,
        tenantId: req.params.id
      });
      res.status(500).json({ error: 'Failed to update tenant status' });
    }
  }

  // GET /api/super/tenants/:id/analytics - Tenant analytics
  static async getTenantAnalytics(req, res) {
    try {
      const { id } = req.params;

      // Validar que tenant existe
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          plan: true,
          costPerMessage: true,
          costPerUser: true,
          currency: true
        }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Timeframe: Current Month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Parallel Queries
      const [usersTotal, usersOnline, msgsSent, msgsRecv, conversations] = await Promise.all([
        prisma.user.count({ where: { tenantId: id, active: true } }),
        prisma.user.count({ where: { tenantId: id, workStatus: 'AVAILABLE' } }),
        prisma.message.count({
          where: {
            conversation: { tenantId: id },
            direction: 'OUTBOUND',
            createdAt: { gte: startOfMonth }
          }
        }),
        prisma.message.count({
          where: {
            conversation: { tenantId: id },
            direction: 'INBOUND',
            createdAt: { gte: startOfMonth }
          }
        }),
        prisma.conversation.count({ where: { tenantId: id, status: { not: 'CLOSED' } } })
      ]);

      // Financial Calc
      const billMessages = msgsSent * (tenant.costPerMessage || 0);
      const billUsers = usersTotal * (tenant.costPerUser || 0);
      const totalEstimated = billMessages + billUsers;

      // Auditoria - apenas log de acesso
      logger.info('[SuperAdmin] Analytics accessed', {
        tenantId: id,
        accessedBy: req.user.userId
      });

      res.json({
        tenant: {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          currency: tenant.currency || 'BRL'
        },
        usage: {
          users: { total: usersTotal, online: usersOnline },
          messages: { sent: msgsSent, received: msgsRecv },
          activeConversations: conversations
        },
        financial: {
          costPerMessage: tenant.costPerMessage || 0,
          costPerUser: tenant.costPerUser || 0,
          estimatedCostMessages: billMessages.toFixed(2),
          estimatedCostUsers: billUsers.toFixed(2),
          totalEstimatedMonth: totalEstimated.toFixed(2)
        }
      });
    } catch (e) {
      logger.error('[SuperAdmin] getTenantAnalytics error:', {
        error: e.message,
        tenantId: req.params.id
      });
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }

  // GET /api/super/metrics - Global system metrics
  static async getGlobalMetrics(req, res) {
    try {
      // Usar aggregation em vez de loop (FIX N+1)
      const tenantsWithMetrics = await prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          plan: true,
          active: true,
          costPerMessage: true,
          costPerUser: true,
          currency: true,
          _count: {
            select: {
              users: true,
              conversations: true,
              messages: true
            }
          }
        }
      });

      // Calcular métricas sem N+1 queries
      const stats = tenantsWithMetrics.map((t) => {
        const totalCost =
          t._count.messages * (t.costPerMessage || 0) +
          t._count.users * (t.costPerUser || 0);

        return {
          tenantId: t.id,
          name: t.name,
          plan: t.plan,
          active: t.active,
          users: t._count.users,
          conversations: t._count.conversations,
          messagesSent: t._count.messages,
          costPerMessage: t.costPerMessage || 0,
          costPerUser: t.costPerUser || 0,
          estimatedCostTotal: totalCost.toFixed(2),
          currency: t.currency || 'BRL'
        };
      });

      // System Totals
      const totalTenants = tenantsWithMetrics.length;
      const activeTenants = tenantsWithMetrics.filter((t) => t.active).length;
      const totalRevenue = stats
        .reduce((acc, curr) => acc + parseFloat(curr.estimatedCostTotal), 0)
        .toFixed(2);
      const totalMessages = tenantsWithMetrics.reduce((acc, curr) => acc + curr._count.messages, 0);
      const totalUsers = tenantsWithMetrics.reduce((acc, curr) => acc + curr._count.users, 0);
      const totalConversations = tenantsWithMetrics.reduce(
        (acc, curr) => acc + curr._count.conversations,
        0
      );

      // Server Stats
      const memUsage = process.memoryUsage();
      const serverStats = {
        uptime: Math.floor(process.uptime()),
        memoryHeapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        memoryHeapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        nodeVersion: process.version,
        timestamp: new Date().toISOString()
      };

      // Auditoria
      logger.info('[SuperAdmin] Global metrics accessed', {
        accessedBy: req.user.userId
      });

      res.json({
        overview: {
          totalTenants,
          activeTenants,
          totalRevenue,
          totalMessages,
          totalUsers,
          totalConversations,
          systemStatus: 'ONLINE'
        },
        server: serverStats,
        tenantMetrics: stats
      });
    } catch (e) {
      logger.error('[SuperAdmin] getGlobalMetrics error:', {
        error: e.message,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to fetch global metrics' });
    }
  }
}

module.exports = SuperAdminController;
