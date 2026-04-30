const logger = require('../utils/logger');
const prisma = require('../services/database');
const bcrypt = require('bcryptjs');
const { logAuditEvent, AuditAction } = require('../services/auditLog.service');
const {
  SaveURAsSchema,
  SavePausesSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  CreateSkillSchema,
  UpdateSettingsSchema
} = require('../schemas/admin.schemas');

class AdminController {
  // --- CONFIG & DASHBOARD ---
  static async getConfig(req, res) {
    try {
      const { tenantId } = req.user;

      // Verify tenant exists
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const [users, skills, tenantData, configuration] = await Promise.all([
        prisma.user.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            workStatus: true,
            active: true,
            skills: { include: { skill: true } }
          }
        }),
        prisma.skill.findMany({ where: { tenantId } }),
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            name: true
          }
        }),
        prisma.configuration.findUnique({
          where: { tenantId },
          select: { phoneNumberId: true }
        })
      ]);

      // Format users for frontend
      const formattedUsers = users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        workStatus: u.workStatus,
        active: u.active,
        skills: u.skills.map((us) => us.skill.name)
      }));

      logger.info('[Admin] Config accessed', {
        tenantId,
        userId: req.user.userId
      });

      res.json({
        users: formattedUsers,
        skills,
        meta: {
          phone_number_id: configuration?.phoneNumberId || null
        }
      });
    } catch (error) {
      logger.error('[Admin] getConfig error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to load config' });
    }
  }

  static async getURAs(req, res) {
    try {
      const { tenantId } = req.user;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { flows: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Default Flow
      const defaultFlow = {
        uras: { Padrão: { start: { type: 'menu', message: 'Olá! Bem-vindo.', options: {} } } },
        active: 'Padrão'
      };

      logger.debug('[Admin] URAs accessed', {
        tenantId,
        userId: req.user.userId
      });

      res.json(tenant.flows || defaultFlow);
    } catch (error) {
      logger.error('[Admin] getURAs error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to fetch URAs' });
    }
  }

  static async saveURAs(req, res) {
    try {
      const { tenantId } = req.user;

      // Validate with Zod schema
      const validation = SaveURAsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { uras, active } = validation.data;

      // Verify tenant exists
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Update flows
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { flows: { uras, active } }
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: ['flows'],
        updatedBy: req.user.userId
      });

      logger.info('[Admin] URAs saved', {
        tenantId,
        userId: req.user.userId,
        activeFlow: active
      });

      res.json({ success: true, message: 'URAs saved successfully' });
    } catch (error) {
      logger.error('[Admin] saveURAs error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to save URAs' });
    }
  }

  static async getPauses(req, res) {
    try {
      const { tenantId } = req.user;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { pauseReasons: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      logger.debug('[Admin] Pause reasons accessed', {
        tenantId,
        userId: req.user.userId
      });

      res.json(tenant.pauseReasons || { reasons: ['Almoço', 'Reunião', 'Banheiro'] });
    } catch (error) {
      logger.error('[Admin] getPauses error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to fetch pause reasons' });
    }
  }

  static async savePauses(req, res) {
    try {
      const { tenantId } = req.user;

      // Validate with Zod schema
      const validation = SavePausesSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { reasons } = validation.data;

      // Verify tenant exists
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Update pause reasons (store directly as array, not nested)
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { pauseReasons: reasons }
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: ['pauseReasons'],
        updatedBy: req.user.userId
      });

      logger.info('[Admin] Pause reasons saved', {
        tenantId,
        userId: req.user.userId,
        count: reasons.length
      });

      res.json({ success: true, message: 'Pause reasons saved successfully' });
    } catch (error) {
      logger.error('[Admin] savePauses error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to save pause reasons' });
    }
  }

  // -------------------------------------------------------------------
  // AGENT MANAGEMENT
  // -------------------------------------------------------------------

  static async listAgents(req, res) {
    try {
      const { tenantId } = req.user;

      const agents = await prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          workStatus: true,
          active: true,
          skills: { include: { skill: true } }
        }
      });

      logger.debug('[Admin] Agents listed', {
        tenantId,
        userId: req.user.userId,
        count: agents.length
      });

      // Format skills
      const formatted = agents.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        workStatus: a.workStatus,
        active: a.active,
        skills: a.skills.map((us) => us.skill.name)
      }));

      res.json(formatted);
    } catch (error) {
      logger.error('[Admin] listAgents error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to fetch agents' });
    }
  }

  static async createAgent(req, res) {
    try {
      const { tenantId, userId: createdBy } = req.user;

      // Validate with Zod schema
      const validation = CreateAgentSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { name, email, password, role, skills } = validation.data;

      // Check email uniqueness within tenant
      const existingAgent = await prisma.user.findFirst({
        where: {
          tenantId,
          email
        }
      });

      if (existingAgent) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { email: ['Email already in use in this tenant'] }
        });
      }

      // Hash password OUTSIDE transaction (bcrypt is slow)
      const hashedPassword = await bcrypt.hash(password, 10);

      // Transaction: Create User + Assign Skills
      const newAgent = await prisma.$transaction(async (tx) => {
        return await tx.user.create({
          data: {
            tenantId,
            name,
            email,
            password: hashedPassword,
            role: role || 'AGENT',
            workStatus: 'AVAILABLE',
            // Assign skills if provided
            skills: skills && skills.length > 0
              ? {
                  create: skills.map((skillId) => ({ skillId }))
                }
              : undefined
          },
          include: { skills: { include: { skill: true } } }
        });
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: ['agent_created', `agent_${newAgent.id}`],
        updatedBy: createdBy,
        agentName: name,
        agentRole: role || 'AGENT'
      });

      logger.info('[Admin] Agent created successfully', {
        tenantId,
        agentId: newAgent.id,
        agentName: name,
        role: role || 'AGENT',
        createdBy
      });

      // Clean response (remove password)
      const { password: _, ...cleanAgent } = newAgent;
      cleanAgent.skills = cleanAgent.skills
        .map((us) => (us.skill ? us.skill.name : null))
        .filter(Boolean);

      res.status(201).json(cleanAgent);
    } catch (error) {
      logger.error('[Admin] createAgent error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to create agent' });
    }
  }

  static async updateAgent(req, res) {
    try {
      const { id } = req.params;
      const { tenantId, userId: updatedBy } = req.user;

      // Validate with Zod schema
      const validation = UpdateAgentSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { name, email, role, skills, password, active } = validation.data;

      // Verify agent exists and belongs to this tenant
      const existingAgent = await prisma.user.findUnique({
        where: { id },
        select: { id: true, tenantId: true, email: true }
      });

      if (!existingAgent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      if (existingAgent.tenantId !== tenantId) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // If email is being changed, verify new email is unique within tenant
      if (email && email !== existingAgent.email) {
        const emailExists = await prisma.user.findFirst({
          where: {
            tenantId,
            email,
            id: { not: id }
          }
        });

        if (emailExists) {
          return res.status(400).json({
            error: 'Validation failed',
            details: { email: ['Email already in use in this tenant'] }
          });
        }
      }

      // Hash password if provided
      const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

      // Prepare update data (only include provided fields)
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;
      if (role !== undefined) updateData.role = role;
      if (active !== undefined) updateData.active = active;
      if (hashedPassword) updateData.password = hashedPassword;

      // Transaction: Update User + Skills
      const updatedUser = await prisma.$transaction(async (tx) => {
        // 1. Update user
        await tx.user.update({
          where: { id },
          data: updateData
        });

        // 2. Update skills if provided
        if (skills !== undefined) {
          await tx.userSkill.deleteMany({ where: { userId: id } });
          if (skills.length > 0) {
            await tx.userSkill.createMany({
              data: skills.map((skillId) => ({ userId: id, skillId }))
            });
          }
        }

        // Fetch updated user with skills
        return await tx.user.findUnique({
          where: { id },
          include: { skills: { include: { skill: true } } }
        });
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: Object.keys(updateData),
        updatedBy,
        agentId: id,
        agentName: name || existingAgent.email
      });

      logger.info('[Admin] Agent updated', {
        tenantId,
        agentId: id,
        changes: Object.keys(updateData),
        updatedBy
      });

      // Clean response (remove password)
      const { password: _, ...cleanUser } = updatedUser;
      cleanUser.skills = cleanUser.skills
        .map((s) => (s.skill ? s.skill.name : null))
        .filter(Boolean);

      res.json(cleanUser);
    } catch (error) {
      logger.error('[Admin] updateAgent error:', {
        error: error.message,
        agentId: req.params.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to update agent' });
    }
  }

  static async deleteAgent(req, res) {
    try {
      const { id } = req.params;
      const { tenantId, userId: deletedBy } = req.user;

      // Ensure we don't delete ourselves
      if (id === req.user.userId) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
      }

      // Verify agent exists and belongs to this tenant
      const agent = await prisma.user.findUnique({
        where: { id },
        select: { id: true, tenantId: true, email: true }
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      if (agent.tenantId !== tenantId) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Delete agent and related skills
      await prisma.$transaction(async (tx) => {
        await tx.userSkill.deleteMany({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: ['agent_deleted'],
        updatedBy: deletedBy,
        agentId: id,
        agentEmail: agent.email
      });

      logger.info('[Admin] Agent deleted', {
        tenantId,
        agentId: id,
        agentEmail: agent.email,
        deletedBy
      });

      res.sendStatus(204);
    } catch (error) {
      logger.error('[Admin] deleteAgent error:', {
        error: error.message,
        agentId: req.params.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  }

  // -------------------------------------------------------------------
  // SKILL MANAGEMENT (Departments)
  // -------------------------------------------------------------------

  static async listSkills(req, res) {
    try {
      const { tenantId } = req.user;

      const skills = await prisma.skill.findMany({
        where: { tenantId },
        include: { _count: { select: { users: true } } }
      });

      logger.debug('[Admin] Skills listed', {
        tenantId,
        userId: req.user.userId,
        count: skills.length
      });

      res.json(skills);
    } catch (error) {
      logger.error('[Admin] listSkills error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to fetch skills' });
    }
  }

  static async createSkill(req, res) {
    try {
      const { tenantId, userId: createdBy } = req.user;

      // Validate with Zod schema
      const validation = CreateSkillSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { name, description } = validation.data;

      const skill = await prisma.skill.create({
        data: {
          tenantId,
          name,
          description: description || null
        }
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: ['skill_created'],
        updatedBy: createdBy,
        skillName: name
      });

      logger.info('[Admin] Skill created', {
        tenantId,
        skillId: skill.id,
        skillName: name,
        createdBy
      });

      res.status(201).json(skill);
    } catch (error) {
      logger.error('[Admin] createSkill error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to create skill' });
    }
  }

  static async deleteSkill(req, res) {
    try {
      const { id } = req.params;
      const { tenantId, userId: deletedBy } = req.user;

      // Verify skill exists and belongs to this tenant
      const skill = await prisma.skill.findUnique({
        where: { id },
        select: { id: true, tenantId: true, name: true }
      });

      if (!skill) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      if (skill.tenantId !== tenantId) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      // Delete skill and related user-skill relations
      await prisma.$transaction(async (tx) => {
        await tx.userSkill.deleteMany({ where: { skillId: id } });
        await tx.skill.delete({ where: { id } });
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: ['skill_deleted'],
        updatedBy: deletedBy,
        skillId: id,
        skillName: skill.name
      });

      logger.info('[Admin] Skill deleted', {
        tenantId,
        skillId: id,
        skillName: skill.name,
        deletedBy
      });

      res.sendStatus(204);
    } catch (error) {
      logger.error('[Admin] deleteSkill error:', {
        error: error.message,
        skillId: req.params.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to delete skill' });
    }
  }

  // -------------------------------------------------------------------
  // TENANT SETTINGS
  // -------------------------------------------------------------------

  static async getSettings(req, res) {
    try {
      const { tenantId } = req.user;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          maxConcurrentAgents: true,
          defaultAgentLanguage: true
        }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      logger.debug('[Admin] Settings accessed', {
        tenantId,
        userId: req.user.userId
      });

      res.json(tenant);
    } catch (error) {
      logger.error('[Admin] getSettings error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  }

  static async updateSettings(req, res) {
    try {
      const { tenantId, userId: updatedBy } = req.user;

      // Validate with Zod schema
      const validation = UpdateSettingsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors
        });
      }

      const { maxConcurrentAgents, defaultAgentLanguage } = validation.data;

      // Verify tenant exists
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true }
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Prepare update data (only include provided fields)
      const updateData = {};
      if (maxConcurrentAgents !== undefined) updateData.maxConcurrentAgents = maxConcurrentAgents;
      if (defaultAgentLanguage !== undefined) updateData.defaultAgentLanguage = defaultAgentLanguage;

      // If no fields to update, return current settings
      if (Object.keys(updateData).length === 0) {
        const currentSettings = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            name: true,
            maxConcurrentAgents: true,
            defaultAgentLanguage: true
          }
        });
        return res.json({ message: 'No changes to apply', settings: currentSettings });
      }

      const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data: updateData,
        select: {
          id: true,
          name: true,
          maxConcurrentAgents: true,
          defaultAgentLanguage: true
        }
      });

      // Auditoria
      await logAuditEvent(AuditAction.TENANT_UPDATED, {
        tenantId,
        changes: Object.keys(updateData),
        updatedBy
      });

      logger.info('[Admin] Settings updated', {
        tenantId,
        changes: Object.keys(updateData),
        updatedBy
      });

      res.json({ message: 'Settings updated successfully', settings: updated });
    } catch (error) {
      logger.error('[Admin] updateSettings error:', {
        error: error.message,
        tenantId: req.user.tenantId,
        userId: req.user.userId
      });
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
}

module.exports = AdminController;
