const logger = require('../utils/logger');
const prisma = require('../services/database');
const AgentStatusService = require('../services/AgentStatusService');

function getNPSScore(surveyResponses) {
  if (!surveyResponses || typeof surveyResponses !== 'object') return '';
  const keys = Object.keys(surveyResponses);
  if (keys.length === 0) return '';

  const npsKeys = ['nps', 'nota', 'satisfacao', 'satisfação', 'rating', 'score', 'avaliacao', 'avaliação'];
  for (const k of npsKeys) {
    const foundKey = keys.find(key => key.toLowerCase() === k);
    if (foundKey) {
      return String(surveyResponses[foundKey]);
    }
  }

  for (const [k, v] of Object.entries(surveyResponses)) {
    const num = parseInt(v);
    if (!isNaN(num) && num >= 0 && num <= 10) {
      return String(v);
    }
  }

  return String(surveyResponses[keys[0]]);
}

function getDeptFromFlowState(flowState) {
  if (!flowState) return null;
  let obj = flowState;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (e) {
      return null;
    }
  }
  return (obj && typeof obj === 'object' && obj.dept) ? obj.dept : null;
}

class SupervisorController {
  // Dashboard: Visão Geral da Equipe
  static async getTeamOverview(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;

      // Lista todos os agentes do tenant (exclui admins/donos se quiser, ou inclui)
      const agents = await prisma.user.findMany({
        where: {
          tenantId,
          role: { in: ['AGENT', 'SUPERVISOR'] }
        },
        select: {
          id: true,
          name: true,
          email: true,
          workStatus: true,
          lastSeenAt: true,
          _count: {
            select: {
              assignedConversations: { where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }
            }
          }
        }
      });

      // Usar AgentStatusService para estatísticas consistentes
      const stats = await AgentStatusService.getStatusStats(tenantId);

      res.json({ stats, agents });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Erro ao carregar visão da equipe' });
    }
  }

  // Ação: Forçar mudança de status de um agente
  static async forceAgentStatus(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const { agentId } = req.params;
      const { status } = req.body; // ONLINE, OFFLINE, BUSY, AWAY

      // Valida se o agente pertence ao tenant
      const agent = await prisma.user.findUnique({ where: { id: agentId } });

      if (!agent || agent.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Agente não encontrado neste tenant' });
      }

      // Impede alterar status de outro Supervisor ou Admin (Hierarquia)
      if (['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(agent.role)) {
        return res.status(403).json({ error: 'Não é permitido alterar status de um superior' });
      }

      // Usar AgentStatusService para garantir consistência (auto-transfer, validações, etc)
      const result = await AgentStatusService.updateStatus(
        agentId,
        status,
        `Alterado por supervisor (${req.user.username || 'Supervisor'})`,
        tenantId
      );

      res.json(result);
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Erro ao alterar status' });
    }
  }

  // Monitoramento: Ver todas as conversas ativas (Mesa de Controle)
  static async getLiveConversations(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;

      const conversations = await prisma.conversation.findMany({
        where: {
          tenantId,
          status: { notIn: ['RESOLVED', 'CLOSED'] } // Apenas ativas
        },
        include: {
          contact: true,
          assignedTo: { select: { name: true, id: true } },
          whatsappConnection: { select: { name: true } },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { lastMessageAt: 'desc' }
      });

      const formatted = conversations.map((c) => ({
        ...c,
        contact: {
          ...c.contact,
          phone: c.contact.phone
        },
        channelName: c.channel === 'WEBCHAT' ? 'Webchat' : (c.whatsappConnection?.name || 'Padrão')
      }));

      res.json(formatted);
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Erro ao listar conversas' });
    }
  }

  // Histórico: Ver conversas resolvidas ou antigas
  static async getHistory(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const limit = parseInt(req.query.limit) || 50;

      const conversations = await prisma.conversation.findMany({
        where: {
          tenantId,
          status: { in: ['RESOLVED', 'CLOSED'] }
        },
        include: {
          contact: true,
          assignedTo: { select: { name: true, id: true } },
          whatsappConnection: { select: { name: true } },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: limit
      });

      const formatted = conversations.map((c) => ({
        ...c,
        contact: {
          ...c.contact,
          phone: c.contact.phone
        },
        channelName: c.channel === 'WEBCHAT' ? 'Webchat' : (c.whatsappConnection?.name || 'Padrão')
      }));

      res.json(formatted);
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
  }

  // Disparo em Massa ("Fire and Forget")
  static async massSend(req, res) {
    try {
      const { tenantId } = req.user;
      const { templateName, language, parameters, phones, whatsappPhoneId, recipients, campaignId } = req.body;

      let recipientList = [];
      if (Array.isArray(recipients) && recipients.length > 0) {
        recipientList = recipients;
      } else if (Array.isArray(phones) && phones.length > 0) {
        recipientList = phones.map(phone => ({
          phone,
          parameters: parameters || []
        }));
      }

      if (!templateName || recipientList.length === 0) {
        return res.status(400).json({ error: 'Parâmetros inválidos. templateName e destinatários são obrigatórios.' });
      }

      // 1. Get Tenant & Configuration
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        return res.status(400).json({ error: 'Tenant não encontrado.' });
      }

      // 🛡️ Validação de Limites de Disparos Mensais (SaaS)
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const currentOutboundCount = await prisma.conversation.count({
        where: {
          tenantId,
          initiationType: 'OUTBOUND',
          createdAt: { gte: startOfMonth }
        }
      });

      const limit = tenant.limitMonthlyOutboundChats;
      if (limit > 0 && (currentOutboundCount + recipientList.length) > limit) {
        return res.status(403).json({
          error: `Limite de disparos mensais excedido. Você possui ${limit - currentOutboundCount} envios disponíveis para este mês, mas tentou enviar para ${recipientList.length} contatos.`
        });
      }

      // 🛡️ Validação de Campanhas Simultâneas
      let campaign = null;
      if (campaignId) {
        campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
        if (campaign) {
          const runningCampaignsCount = await prisma.campaign.count({
            where: { tenantId, status: 'RUNNING', id: { not: campaignId } }
          });
          if (tenant.limitActiveCampaigns > 0 && runningCampaignsCount >= tenant.limitActiveCampaigns) {
            return res.status(403).json({
              error: `Limite de campanhas simultâneas rodando atingido (${tenant.limitActiveCampaigns} campanhas permitidas).`
            });
          }
          // Atualiza status para RUNNING
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: 'RUNNING' }
          });
        }
      } else {
        const runningCampaignsCount = await prisma.campaign.count({
          where: { tenantId, status: 'RUNNING' }
        });
        if (tenant.limitActiveCampaigns > 0 && runningCampaignsCount >= tenant.limitActiveCampaigns) {
          return res.status(403).json({
            error: `Limite de campanhas simultâneas rodando atingido (${tenant.limitActiveCampaigns} campanhas permitidas).`
          });
        }
      }

      let config;
      if (whatsappPhoneId) {
        config = await prisma.configuration.findFirst({
          where: { tenantId, phoneNumberId: whatsappPhoneId }
        });
      }

      if (!config) {
        config = await prisma.configuration.findFirst({
          where: { tenantId }
        });
      }

      if (!config || !config.phoneNumberId || !config.whatsappToken) {
        return res.status(400).json({ error: 'WhatsApp não configurado para este tenant.' });
      }

      // 2. Load template from database to compile text
      const templateObj = await prisma.template.findUnique({
        where: { tenantId_name: { tenantId, name: templateName } }
      });
      if (!templateObj) {
        return res.status(404).json({ error: `Template '${templateName}' não encontrado.` });
      }

      const whatsappService = require('../services/whatsapp');

      let successCount = 0;
      let failCount = 0;

      for (const recipient of recipientList) {
        const { phone, parameters: recipientParams } = recipient;
        try {
          // Find/create contact
          const { getBrPhoneOptions } = require('../utils/validators');
          const phoneOptions = getBrPhoneOptions(phone);
          let contact = await prisma.contact.findFirst({
            where: {
              tenantId,
              phone: { in: phoneOptions }
            }
          });
          if (!contact) {
            contact = await prisma.contact.create({
              data: { tenantId, phone, name: phone }
            });
          }

          // Find or create BOT conversation
          let conversation = await prisma.conversation.findFirst({
            where: {
              contactId: contact.id,
              tenantId,
              status: { notIn: ['RESOLVED', 'CLOSED'] },
              whatsappPhoneId: config.phoneNumberId
            }
          });

          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                contactId: contact.id,
                tenantId,
                status: 'BOT',
                initiationType: 'OUTBOUND',
                whatsappPhoneId: config.phoneNumberId,
                campaignId: campaignId || null
              }
            });
          } else if (campaignId && !conversation.campaignId) {
            conversation = await prisma.conversation.update({
              where: { id: conversation.id },
              data: { campaignId }
            });
          }

          // Send template via WhatsApp
          let templateObjComponents = templateObj.components;
          if (typeof templateObjComponents === 'string') {
            try {
              templateObjComponents = JSON.parse(templateObjComponents);
            } catch (e) {
              templateObjComponents = [];
            }
          }
          if (templateObjComponents && !Array.isArray(templateObjComponents) && Array.isArray(templateObjComponents.components)) {
            templateObjComponents = templateObjComponents.components;
          }
          if (!Array.isArray(templateObjComponents)) {
            templateObjComponents = [];
          }

          const normalizedParams = (recipientParams || []).map((p, idx) => {
            if (p && typeof p === 'object' && 'name' in p && 'value' in p) {
              return { name: p.name, value: p.value };
            }
            let placeholderName = String(idx + 1);
            const bodyComp = templateObjComponents.find(c => c.type === 'BODY');
            if (bodyComp && bodyComp.text) {
              const regex = /\{\{([^}]+)\}\}/g;
              let match;
              const placeholders = [];
              while ((match = regex.exec(bodyComp.text)) !== null) {
                const pName = match[1].trim();
                if (!placeholders.includes(pName)) {
                  placeholders.push(pName);
                }
              }
              if (placeholders[idx]) {
                placeholderName = placeholders[idx];
              }
            }
            return { name: placeholderName, value: String(p) };
          });

          const componentsPayload = normalizedParams.length > 0 ? [
            {
              type: 'body',
              parameters: normalizedParams.map(p => {
                const paramObj = {
                  type: 'text',
                  text: String(p.value)
                };
                if (!/^\d+$/.test(p.name)) {
                  paramObj.parameter_name = p.name;
                }
                return paramObj;
              })
            }
          ] : [];

          const tenantObj = { id: tenantId, whatsappPhoneId: config.phoneNumberId };

          const metaRes = await whatsappService.sendTemplate(
            phone,
            templateName,
            language || 'pt_BR',
            componentsPayload,
            tenantObj
          );

          const waMessageId = metaRes?.messages?.[0]?.id;

          // Compilar texto do template (helper) especificamente para este destinatário
          const compiledText = compileTemplateText(templateObj, { templateName, parameters: recipientParams });

          // Save message to database
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              content: compiledText,
              contentType: 'template',
              direction: 'OUTBOUND',
              senderId: req.user.userId,
              waId: waMessageId || `mass_${Date.now()}_${phone}`,
              status: waMessageId ? 'sent' : 'failed',
              createdAt: new Date()
            }
          });

          // Update lastMessageAt on the conversation
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() }
          });

          if (waMessageId) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (phoneErr) {
          logger.error(`[MassSend] Failed to process phone ${phone}:`, phoneErr);
          failCount++;
        }
      }

      // 🛡️ Finaliza a campanha atualizando seu status
      if (campaign) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            status: 'COMPLETED',
            finishedAt: new Date(),
            successCount,
            failCount
          }
        }).catch(err => logger.error('[MassSend] Error finalizing campaign:', err.message));
      }

      res.json({
        success: true,
        total: recipientList.length,
        successCount,
        failCount
      });
    } catch (error) {
      logger.error('[SupervisorController] massSend error:', error);
      // 🛡️ Marca a campanha como FAILED em caso de erro crítico
      if (campaignId) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: {
            status: 'FAILED',
            finishedAt: new Date()
          }
        }).catch(() => {});
      }
      res.status(500).json({ error: 'Erro interno no disparo em massa.' });
    }
  }

  // GET /api/supervisor/dashboard-stats
  static async getDashboardStats(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;

      // 1. Atendimentos por Status (BOT, QUEUED, ASSIGNED, RESOLVED, CLOSED)
      const chatsByStatus = await prisma.conversation.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { id: true }
      });

      // 2. Agentes por Status de Trabalho (ONLINE, BUSY, OFFLINE, AWAY)
      const stats = await AgentStatusService.getStatusStats(tenantId);

      // 3. Agentes por Skill/Departamento
      const skills = await prisma.skill.findMany({
        where: { tenantId },
        include: {
          _count: {
            select: { users: true }
          }
        }
      });
      const agentsBySkill = skills.map(s => ({
        name: s.name,
        count: s._count.users
      }));

      // 4. Atendimentos por Canal (WhatsApp & Webchat Connections)
      const [connections, webchatConnections] = await Promise.all([
        prisma.configuration.findMany({
          where: { tenantId },
          select: { phoneNumberId: true, name: true }
        }),
        prisma.webchatConnection.findMany({
          where: { tenantId },
          select: { id: true, name: true }
        })
      ]);

      const chatsByWA = await prisma.conversation.groupBy({
        by: ['whatsappPhoneId'],
        where: { tenantId, channel: 'WHATSAPP' },
        _count: { id: true }
      });

      const chatsByWC = await prisma.conversation.groupBy({
        by: ['webchatConnectionId'],
        where: { tenantId, channel: 'WEBCHAT' },
        _count: { id: true }
      });

      const chatsByChannel = [];

      chatsByWA.forEach(item => {
        const conn = connections.find(c => c.phoneNumberId === item.whatsappPhoneId);
        chatsByChannel.push({
          channelName: conn ? `WA: ${conn.name}` : (item.whatsappPhoneId ? `WA: ${item.whatsappPhoneId}` : 'WA: Padrão'),
          count: item._count.id
        });
      });

      chatsByWC.forEach(item => {
        const conn = webchatConnections.find(c => c.id === item.webchatConnectionId);
        chatsByChannel.push({
          channelName: conn ? `WC: ${conn.name}` : 'Webchat',
          count: item._count.id
        });
      });

      // 5. Atendimentos por Sentimento de IA (Satisfação)
      const chatsBySentimentRaw = await prisma.conversation.groupBy({
        by: ['aiSentiment'],
        where: { 
          tenantId,
          aiSentiment: { not: null }
        },
        _count: { id: true }
      });
      const chatsBySentiment = chatsBySentimentRaw.map(item => ({
        sentiment: item.aiSentiment,
        count: item._count.id
      }));

      // 6. Atendimentos por Motivo de Fechamento (Disposição)
      const chatsByDispositionRaw = await prisma.conversation.groupBy({
        by: ['disposition'],
        where: { 
          tenantId,
          disposition: { not: null, not: "" }
        },
        _count: { id: true }
      });
      const chatsByDisposition = chatsByDispositionRaw.map(item => ({
        disposition: item.disposition,
        count: item._count.id
      }));

      // 7. Volumetria de atendimentos nas últimas 24 horas (agrupado por hora)
      const activeChats = await prisma.conversation.findMany({
        where: {
          tenantId,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        },
        select: { createdAt: true }
      });
      const hoursMap = {};
      for (let i = 0; i < 24; i++) {
        hoursMap[i] = 0;
      }
      activeChats.forEach(c => {
        const hr = new Date(c.createdAt).getHours();
        hoursMap[hr] = (hoursMap[hr] || 0) + 1;
      });
      const chatsByHour = Object.keys(hoursMap).map(h => ({
        hour: `${String(h).padStart(2, '0')}:00`,
        count: hoursMap[h]
      }));

      // 8. Produtividade por Agente (Conversas Resolvidas)
      const resolvedChats = await prisma.conversation.groupBy({
        by: ['assignedToId'],
        where: { 
          tenantId,
          status: 'RESOLVED',
          assignedToId: { not: null }
        },
        _count: { id: true }
      });
      const agents = await prisma.user.findMany({
        where: { tenantId, role: 'AGENT' },
        select: { id: true, name: true }
      });
      const agentProductivity = resolvedChats.map(item => {
        const agent = agents.find(a => a.id === item.assignedToId);
        return {
          agentName: agent ? agent.name : 'Agente Removido',
          count: item._count.id
        };
      });

      res.json({
        chatsByStatus: chatsByStatus.map(item => ({ status: item.status, count: item._count.id })),
        agentsByStatus: [
          { status: 'ONLINE', count: stats.online },
          { status: 'BUSY', count: stats.busy },
          { status: 'OFFLINE', count: stats.offline },
          { status: 'AWAY', count: stats.away || 0 }
        ],
        agentsBySkill,
        chatsByChannel,
        chatsBySentiment,
        chatsByDisposition,
        chatsByHour,
        agentProductivity
      });
    } catch (error) {
      logger.error('[SupervisorController] getDashboardStats error:', error);
      res.status(500).json({ error: 'Erro ao gerar métricas do painel.' });
    }
  }

  // GET /api/supervisor/reports
  static async getReports(req, res) {
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const { startDate, endDate, agentId, skill, status, format, query, channels } = req.query;

      logger.info('[SupervisorController] getReports filters:', { tenantId, startDate, endDate, agentId, skill, status, format, query, channels });

      const whereClause = {
        tenantId
      };

      if (channels) {
        let channelList = [];
        if (Array.isArray(channels)) {
          channelList = channels;
        } else if (typeof channels === 'string') {
          channelList = channels.split(',').map(c => c.trim()).filter(Boolean);
        }
        if (channelList.length > 0) {
          whereClause.channel = { in: channelList };
        }
      }

      if (query) {
        whereClause.contact = {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } }
          ]
        };
      }

      if (startDate || endDate) {
        whereClause.createdAt = {};
        if (startDate) {
          whereClause.createdAt.gte = new Date(`${startDate}T00:00:00`);
        }
        if (endDate) {
          whereClause.createdAt.lte = new Date(`${endDate}T23:59:59.999`);
        }
      }

      if (agentId) {
        whereClause.assignedToId = agentId;
      }

      if (skill) {
        whereClause.dept = skill;
      }

      if (status) {
        whereClause.status = status;
      }

      const conversations = await prisma.conversation.findMany({
        where: whereClause,
        include: {
          contact: true,
          assignedTo: { select: { name: true, email: true } },
          messages: {
            where: { direction: 'OUTBOUND', senderId: { not: null } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { createdAt: true }
          },
          _count: {
            select: { messages: true, transfers: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      // Cálculos de Métricas de Contact Center (TME, TMA e FCR)
      let totalWaitSec = 0;
      let waitCount = 0;
      let totalHandleSec = 0;
      let handleCount = 0;
      let fcrCount = 0;
      let resolvedCount = 0;

      conversations.forEach(c => {
        const firstHumanMsg = c.messages && c.messages[0] ? new Date(c.messages[0].createdAt) : null;
        
        // 1. TME: Tempo até o primeiro atendimento humano
        if (firstHumanMsg) {
          const waitSec = Math.max(0, Math.round((firstHumanMsg - new Date(c.createdAt)) / 1000));
          totalWaitSec += waitSec;
          waitCount++;
        }

        // 2. TMA e FCR: Apenas para conversas resolvidas ou fechadas
        if (c.status === 'RESOLVED' || c.status === 'CLOSED') {
          resolvedCount++;
          const startTime = firstHumanMsg || new Date(c.createdAt);
          const endTime = new Date(c.updatedAt);
          const handleSec = Math.max(0, Math.round((endTime - startTime) / 1000));
          totalHandleSec += handleSec;
          handleCount++;

          // FCR: Sem transferências
          if (!c._count?.transfers || c._count.transfers === 0) {
            fcrCount++;
          }
        }
      });

      const avgTmeSec = waitCount > 0 ? Math.round(totalWaitSec / waitCount) : 0;
      const avgTmaSec = handleCount > 0 ? Math.round(totalHandleSec / handleCount) : 0;
      const fcrPercent = resolvedCount > 0 ? ((fcrCount / resolvedCount) * 100).toFixed(1) : (conversations.length > 0 ? '100.0' : '0.0');

      function formatDuration(sec) {
        if (isNaN(sec) || sec <= 0) return '00s';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        if (m === 0) return `${s}s`;
        const h = Math.floor(m / 60);
        const remM = m % 60;
        if (h === 0) return `${String(remM).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
        return `${h}h ${String(remM).padStart(2, '0')}m`;
      }

      const metrics = {
        tmeFormatted: formatDuration(avgTmeSec),
        tmaFormatted: formatDuration(avgTmaSec),
        fcrRate: `${fcrPercent}%`,
        tmeSeconds: avgTmeSec,
        tmaSeconds: avgTmaSec,
        totalAnalyzed: conversations.length,
        totalResolved: resolvedCount,
        fcrCount
      };

      const records = conversations.map(c => ({
        id: c.id,
        contactName: c.contact?.name || 'Sem nome',
        contactPhone: c.contact?.phone || 'Sem telefone',
        initiationType: c.initiationType,
        channel: c.channel || 'WHATSAPP',
        status: c.status,
        skill: c.dept || 'Sem Skill',
        agentName: c.assignedTo?.name || 'N/A',
        agentEmail: c.assignedTo?.email || 'N/A',
        totalMessages: c._count?.messages || 0,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        closingNotes: c.closingNotes || '',
        disposition: c.disposition || '',
        surveyResponses: c.surveyResponses || null,
        npsScore: getNPSScore(c.surveyResponses),
        aiSentiment: c.aiSentiment || 'N/A',
        aiSummary: c.aiSummary || '',
        aiTags: Array.isArray(c.aiTags) ? c.aiTags.join(', ') : ''
      }));

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=relatorio_conversas.csv');
        res.write('\uFEFF'); // UTF-8 BOM for Excel compatibility

        const headers = [
          'ID Conversa', 'Cliente Nome', 'Cliente Telefone', 'Origem', 'Canal', 'Status', 
          'Skill', 'Agente', 'E-mail Agente', 'Total Mensagens', 'Criado Em', 
          'Atualizado Em', 'Notas de Encerramento', 'Desfecho', 'Pesquisa (NPS)',
          'Sentimento IA', 'Resumo IA', 'Tags IA'
        ];
        res.write(headers.join(';') + '\n');

        records.forEach(r => {
          const row = [
            r.id,
            r.contactName.replace(/;/g, ','),
            r.contactPhone,
            r.initiationType,
            r.channel,
            r.status,
            r.skill,
            r.agentName.replace(/;/g, ','),
            r.agentEmail,
            r.totalMessages,
            r.createdAt,
            r.updatedAt,
            (r.closingNotes || '').replace(/[\n\r;]/g, ' '),
            r.disposition.replace(/;/g, ','),
            r.npsScore, // Apenas a nota simplificada no CSV
            r.aiSentiment,
            (r.aiSummary || '').replace(/[\n\r;]/g, ' '),
            (r.aiTags || '').replace(/;/g, ',')
          ];
          res.write(row.join(';') + '\n');
        });
        return res.end();
      }

      res.json({ records, metrics });
    } catch (e) {
      logger.error('[SupervisorController] getReports error:', e);
      res.status(500).json({ error: 'Erro ao gerar relatório' });
    }
  }
}

function compileTemplateText(templateObj, reqBody) {
  if (!templateObj || !templateObj.components) {
    return `Modelo enviado: ${reqBody.templateName}`;
  }

  let components = templateObj.components;
  if (typeof components === 'string') {
    try {
      components = JSON.parse(components);
    } catch (e) {
      components = [];
    }
  }
  if (components && !Array.isArray(components) && Array.isArray(components.components)) {
    components = components.components;
  }
  if (!Array.isArray(components)) {
    return `Modelo enviado: ${reqBody.templateName}`;
  }

  const bodyComp = components.find(c => c.type === 'BODY');
  if (!bodyComp || !bodyComp.text) {
    return `Modelo enviado: ${reqBody.templateName}`;
  }

  let text = bodyComp.text;

  // Extrair parâmetros
  let params = [];
  if (reqBody.parameters && Array.isArray(reqBody.parameters)) {
    params = reqBody.parameters;
  } else if (reqBody.components && Array.isArray(reqBody.components)) {
    const bodyComponentVal = reqBody.components.find(c => c.type === 'body');
    if (bodyComponentVal && Array.isArray(bodyComponentVal.parameters)) {
      params = bodyComponentVal.parameters.map(p => p.text || '');
    }
  }

  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  const variables = new Set();
  while ((match = regex.exec(text)) !== null) {
    variables.add(match[1].trim());
  }
  const uniqueVars = Array.from(variables);
  const isAllNumeric = uniqueVars.every(v => /^\d+$/.test(v));
  if (isAllNumeric) {
    uniqueVars.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  uniqueVars.forEach((name, idx) => {
    if (idx < params.length) {
      text = text.split(`{{${name}}}`).join(String(params[idx]));
    }
  });

  return text;
}

module.exports = SupervisorController;
