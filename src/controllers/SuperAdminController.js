const prisma = const logger = require('../utils/logger');
const '../services/database');
const bcrypt = require('bcryptjs');

class SuperAdminController {
  static async listTenants(req, res) {
    try {
      const tenants = await prisma.tenant.findMany({
        include: {
          _count: {
            select: { users: true, conversations: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(tenants);
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Failed to list tenants' });
    }
  }

  static async createTenant(req, res) {
    try {
      const { name, slug, email, password, plan } = req.body;

      if (!name || !slug || !email || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
      if (existingTenant) {
        return res.status(400).json({ error: 'Slug already taken' });
      }

      // Hash password OUTSIDE transaction (bcrypt is slow, could timeout tx)
      const hashedPassword = await bcrypt.hash(password, 10);

      // Transaction: Create Tenant + First Admin User + Configuration Record
      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name,
            slug,
            plan: plan || 'free',
            active: true,
            waPhoneId: null // Will be synchronized via Configuration.phoneNumberId later
          }
        });

        const user = await tx.user.create({
          data: {
            name: `${name} Admin`,
            email,
            password: hashedPassword, // Use pre-hashed password
            role: 'OWNER',
            tenantId: tenant.id
          }
        });

        // Create empty Configuration record (admin will fill it via panel)
        // This allows webhooks to find the tenant once Configuration is populated
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

      res.status(201).json(result);
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Failed to create tenant' });
    }
  }

  static async toggleTenantStatus(req, res) {
    try {
      const { id } = req.params;
      const { active } = req.body; // boolean

      const tenant = await prisma.tenant.update({
        where: { id },
        data: { active }
      });
      res.json(tenant);
    } catch (e) {
      res.status(500).json({ error: 'Failed to update Status' });
    }
  }

  static async updateTenant(req, res) {
    try {
      const { id } = req.params;
      const { name, plan, waPhoneId, waBusinessId, waAccessToken, costPerMessage, costPerUser } =
        req.body;

      const tenant = await prisma.tenant.update({
        where: { id },
        data: {
          name,
          plan,
          waPhoneId,
          waBusinessId,
          waAccessToken,
          costPerMessage: parseFloat(costPerMessage || 0),
          costPerUser: parseFloat(costPerUser || 0)
        }
      });
      res.json(tenant);
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Failed to update Tenant' });
    }
  }

  static async getTenantAnalytics(req, res) {
    // Metrics per Tenant
    try {
      const { id } = req.params;
      const tenant = await prisma.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Timeframe: Current Month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Parallel Queries
      const [usersTotal, usersOnline, msgsSent, msgsRecv, campaigns] = await Promise.all([
        prisma.user.count({ where: { tenantId: id } }),
        prisma.user.count({ where: { tenantId: id, workStatus: 'ONLINE' } }),
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
        prisma.campaign.count({ where: { tenantId: id } })
      ]);

      // Financial Calc
      const billMessages = msgsSent * (tenant.costPerMessage || 0);
      const billUsers = usersTotal * (tenant.costPerUser || 0);
      const totalEstimated = billMessages + billUsers;

      res.json({
        tenant: { name: tenant.name, plan: tenant.plan, currency: tenant.currency },
        usage: {
          users: { total: usersTotal, online: usersOnline },
          messages: { sent: msgsSent, received: msgsRecv },
          campaigns: campaigns
        },
        financial: {
          costPerMessage: tenant.costPerMessage,
          costPerUser: tenant.costPerUser,
          billMessages,
          billUsers,
          totalEstimated
        }
      });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Analytics Error' });
    }
  }

  static async getGlobalMetrics(req, res) {
    try {
      const tenants = await prisma.tenant.findMany({
        include: {
          users: true,
          _count: {
            select: {
              conversations: true
            }
          }
        }
      });

      const stats = [];

      for (const t of tenants) {
        // Count OUTBOUND messages for billing (All time or current month? User asked for stats, let's do all time or generic)
        // Let's do All Time for simplicity of "Server Stats", but usually billing is monthly.
        // For this request, I will calculate Total All Time for cost estimation.

        const messageCount = await prisma.message.count({
          where: {
            conversation: {
              tenantId: t.id
            },
            direction: 'OUTBOUND'
          }
        });

        const activeUsers = t.users.length;
        const totalCost =
          messageCount * (t.costPerMessage || 0) + activeUsers * (t.costPerUser || 0);

        stats.push({
          tenantId: t.id,
          name: t.name,
          plan: t.plan,
          active: t.active,
          users: activeUsers,
          conversations: t._count.conversations,
          messagesSent: messageCount,
          unitCostMsg: t.costPerMessage || 0,
          unitCostUser: t.costPerUser || 0,
          estimatedCost: totalCost.toFixed(2),
          currency: t.currency || 'BRL'
        });
      }

      // System Totals
      const totalTenants = tenants.length;
      const totalRevenue = stats
        .reduce((acc, curr) => acc + parseFloat(curr.estimatedCost), 0)
        .toFixed(2);
      const totalMessagesOut = stats.reduce((acc, curr) => acc + curr.messagesSent, 0);
      const totalUsers = stats.reduce((acc, curr) => acc + curr.users, 0);

      // Simple Server Resource Checks (Mocked/Simple Node Stats)
      const serverStats = {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version
      };

      res.json({
        overview: {
          totalTenants,
          totalRevenue,
          totalMessagesOut,
          totalUsers,
          systemStatus: 'ONLINE',
          server: serverStats
        },
        details: stats
      });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Error fetching metrics' });
    }
  }
}

module.exports = SuperAdminController;
