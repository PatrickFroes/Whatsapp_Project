const logger = require('../utils/logger');
const prisma =
require('../services/database');
const bcrypt = require('bcryptjs');

class AdminController {
  // --- CONFIG & DASHBOARD ---
  static async getConfig(req, res) {
    try {
      const { tenantId } = req.user; // From authMiddleware

      const [users, skills, tenant] = await Promise.all([
        prisma.user.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            workStatus: true,
            skills: { include: { skill: true } } // Include assigned skills
          }
        }),
        prisma.skill.findMany({ where: { tenantId } }),
        prisma.tenant.findUnique({ where: { id: tenantId } })
      ]);

      // Format users for frontend
      const formattedUsers = users.map((u) => ({
        ...u,
        skills: u.skills.map((us) => us.skill.name) // Flatten skills to array of strings
      }));

      res.json({
        users: formattedUsers,
        skills,
        meta: {
          phone_number_id: tenant.waPhoneId,
          business_id: tenant.waBusinessId
        }
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to load config' });
    }
  }

  static async getURAs(req, res) {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { flows: true }
      });
      // Default Flow
      const defaultFlow = {
        uras: { Padrão: { start: { type: 'menu', message: 'Olá! Bem-vindo.', options: {} } } },
        active: 'Padrão'
      };

      res.json(tenant.flows || defaultFlow);
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed' });
    }
  }

  static async saveURAs(req, res) {
    try {
      // req.body should be: { uras: {...}, active: '...' }
      await prisma.tenant.update({
        where: { id: req.user.tenantId },
        data: { flows: req.body }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed' });
    }
  }

  static async getPauses(req, res) {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { pauseReasons: true }
      });
      res.json(tenant.pauseReasons || { reasons: ['Almoço', 'Reunião', 'Banheiro'] });
    } catch (error) {
      res.status(500).json({ error: 'Failed' });
    }
  }

  static async savePauses(req, res) {
    try {
      const { reasons } = req.body;
      await prisma.tenant.update({
        where: { id: req.user.tenantId },
        data: { pauseReasons: { reasons } }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed' });
    }
  }

  // -------------------------------------------------------------------
  // AGENT MANAGEMENT
  // -------------------------------------------------------------------

  static async listAgents(req, res) {
    try {
      const agents = await prisma.user.findMany({
        where: { tenantId: req.tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          workStatus: true,
          skills: { include: { skill: true } }
        }
      });
      res.json(agents);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch agents' });
    }
  }

  static async createAgent(req, res) {
    try {
      const { name, email, password, role, skills } = req.body; // skills = ['ID1', 'ID2']

      const hashedPassword = await bcrypt.hash(password, 10);

      const newAgent = await prisma.user.create({
        data: {
          tenantId: req.tenantId,
          name,
          email,
          password: hashedPassword,
          role: role || 'AGENT',
          // Create skill relations if provided
          skills: skills
            ? {
                create: skills.map((skillId) => ({ skillId }))
              }
            : undefined
        },
        include: { skills: { include: { skill: true } } }
      });

      const { password: _, ...cleanAgent } = newAgent;

      // Safety check for skills
      if (cleanAgent.skills && Array.isArray(cleanAgent.skills)) {
        cleanAgent.skills = cleanAgent.skills
          .map((us) => (us.skill ? us.skill.name : null))
          .filter(Boolean);
      } else {
        cleanAgent.skills = [];
      }

      res.status(201).json(cleanAgent);
    } catch (error) {
      logger.error('Error creating agent:', error);
      res.status(500).json({ error: 'Failed to create agent', details: error.message });
    }
  }

  static async updateAgent(req, res) {
    try {
      const { id } = req.params;
      const { name, email, role, skills, password } = req.body;

      // Hash password OUTSIDE transaction (bcrypt is slow, could timeout)
      const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

      // Prepare Update Data
      const data = {
        name,
        email,
        role,
        ...(hashedPassword && { password: hashedPassword })
      };

      // Transaction to update user and skills
      await prisma.$transaction(async (tx) => {
        // 1. Update User
        await tx.user.update({
          where: { id, tenantId: req.tenantId },
          data
        });

        // 2. Update Skills
        if (skills) {
          await tx.userSkill.deleteMany({ where: { userId: id } });
          if (skills.length > 0) {
            await tx.userSkill.createMany({
              data: skills.map((skillId) => ({ userId: id, skillId }))
            });
          }
        }
      });

      const updatedUser = await prisma.user.findUnique({
        where: { id },
        include: { skills: { include: { skill: true } } }
      });

      // Flatten skills for consistency
      const formatted = {
        ...updatedUser,
        skills: updatedUser.skills.map((s) => s.skill.name)
      };

      res.json(formatted);
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to update agent' });
    }
  }

  static async deleteAgent(req, res) {
    try {
      const { id } = req.params;
      // Ensure we don't delete ourselves?
      if (id === req.user.userId) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
      }

      // Ensure tenant ownership via where clause
      await prisma.user.delete({
        where: { id, tenantId: req.tenantId }
      });
      res.sendStatus(204);
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  }

  // -------------------------------------------------------------------
  // SKILL MANAGEMENT (Departments)
  // -------------------------------------------------------------------

  static async listSkills(req, res) {
    try {
      const skills = await prisma.skill.findMany({
        where: { tenantId: req.tenantId },
        include: { _count: { select: { users: true } } }
      });
      res.json(skills);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch skills' });
    }
  }

  static async createSkill(req, res) {
    try {
      const { name, description } = req.body;
      const skill = await prisma.skill.create({
        data: {
          tenantId: req.tenantId,
          name,
          description
        }
      });
      res.status(201).json(skill);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create skill' });
    }
  }

  static async deleteSkill(req, res) {
    try {
      const { id } = req.params;
      await prisma.skill.delete({
        where: { id, tenantId: req.tenantId }
      });
      res.sendStatus(204);
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to delete skill' });
    }
  }

  // -------------------------------------------------------------------
  // TENANT SETTINGS (WhatsApp Config)
  // -------------------------------------------------------------------

  static async getSettings(req, res) {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: {
          name: true,
          waPhoneId: true,
          waBusinessId: true
          // Do not return accessToken usually, or mask it
        }
      });
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  }

  static async updateSettings(req, res) {
    try {
      const { waPhoneId, waBusinessId, waAccessToken, name } = req.body;

      const updated = await prisma.tenant.update({
        where: { id: req.tenantId },
        data: {
          waPhoneId,
          waBusinessId,
          waAccessToken, // Verify if this should be encrypted in DB
          name
        }
      });

      res.json({ message: 'Settings updated' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
}

module.exports = AdminController;
