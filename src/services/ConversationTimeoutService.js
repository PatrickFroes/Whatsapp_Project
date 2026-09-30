const prisma = require('./database');
const logger = require('../utils/logger');
const socketService = require('./socket');
const QueueService = require('./QueueService');

class ConversationTimeoutService {
  static init(intervalMs = 60 * 1000) {
    logger.info(`[TimeoutService] Inicializando timer de conversas expiradas (intervalo: ${intervalMs / 1000}s)`);
    setInterval(() => {
      this.checkExpiredConversations().catch(err => {
        logger.error('[TimeoutService] Erro ao verificar expiradas:', err.message);
      });
    }, intervalMs);
  }

  static async checkExpiredConversations() {
    // 1. Get all active conversations (BOT, QUEUED, ASSIGNED)
    const activeConversations = await prisma.conversation.findMany({
      where: {
        status: { in: ['BOT', 'QUEUED', 'ASSIGNED'] }
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        flowState: true,
        assignedToId: true,
        tenantId: true,
        contact: {
          select: {
            phone: true,
            name: true
          }
        },
        tenant: {
          select: {
            id: true,
            name: true,
            featureSurvey: true,
            surveyEnabled: true,
            surveyFlowId: true,
            flows: true,
            queueAlertConfig: true,
            conversationTimeoutMinutes: true
          }
        }
      }
    });

    const now = new Date();

    for (const conv of activeConversations) {
      const tenant = conv.tenant;
      const nowTime = now.getTime();

      // ====== ALERTA DE FILA (STATUS QUEUED APENAS) ======
      if (conv.status === 'QUEUED') {
        const alertConfig = tenant.queueAlertConfig;
        if (alertConfig && typeof alertConfig === 'object' && alertConfig.enabled) {
          const maxWait = alertConfig.maxWaitMinutes || 10;
          const notificationType = alertConfig.notificationType; // 'EMAIL' ou 'WEBHOOK'
          const target = alertConfig.target;

          if (target) {
            let queuedAtStr = null;
            if (conv.flowState && typeof conv.flowState === 'object') {
              queuedAtStr = conv.flowState.queuedAt;
            } else if (conv.flowState && typeof conv.flowState === 'string') {
              try {
                const fsObj = JSON.parse(conv.flowState);
                queuedAtStr = fsObj.queuedAt;
              } catch (e) {}
            }

            const queuedAt = queuedAtStr ? new Date(queuedAtStr) : new Date(conv.updatedAt);
            const waitMs = nowTime - queuedAt.getTime();
            const waitMinutes = Math.floor(waitMs / (60 * 1000));

            if (waitMinutes >= maxWait) {
              let alertTriggered = false;
              let fsObj = {};
              try {
                fsObj = typeof conv.flowState === 'object' ? (conv.flowState || {}) : JSON.parse(conv.flowState || '{}');
                alertTriggered = fsObj.queueAlertSent || false;
              } catch (e) {}

              if (!alertTriggered) {
                logger.info(`[QueueAlert] Conversa ${conv.id} na fila há ${waitMinutes}min (limite ${maxWait}min). Enviando alerta via ${notificationType} para ${target}`);
                
                // Dispara notificação externa
                this.sendQueueAlertNotification(tenant, conv, waitMinutes, notificationType, target);

                // Marcar que já enviou para não duplicar no loop a cada 60s
                fsObj.queueAlertSent = true;
                await prisma.conversation.update({
                  where: { id: conv.id },
                  data: { flowState: fsObj }
                });
              }
            }
          }
        }
      }

      // ====== EXPIRAÇÃO POR INATIVIDADE ======
      const lastMsgAt = new Date(conv.lastMessageAt);
      const diffMs = nowTime - lastMsgAt.getTime();
      const diffMinutes = Math.floor(diffMs / (60 * 1000));

      let isExpired = false;
      let limitMinutes = 60; // default inbound limit (1 hour)

      if (conv.initiationType === 'OUTBOUND') {
        // Outbound is always 24 hours (1440 minutes)
        limitMinutes = 1440;
      } else {
        // Inbound limit comes from tenant settings
        limitMinutes = tenant.inboundTimeoutMinutes || 60;
      }

      if (diffMinutes >= limitMinutes) {
        isExpired = true;
      }

      if (isExpired) {
        logger.info(`[TimeoutService] Conversa ${conv.id} expirada por inatividade. Tipo: ${conv.initiationType}, Limite: ${limitMinutes}min, Sem mensagens há: ${diffMinutes}min.`);
        await this.expireConversation(conv);
      }
    }
  }

  static async expireConversation(conv) {
    try {
      const tenant = conv.tenant;

      let campaign = null;
      if (conv.campaignId) {
        campaign = await prisma.campaign.findUnique({
          where: { id: conv.campaignId }
        });
      }

      let surveyFlowId = null;
      if (campaign && campaign.surveyEnabled && campaign.surveyFlowId) {
        surveyFlowId = campaign.surveyFlowId;
      } else if (tenant && tenant.featureSurvey && tenant.surveyEnabled && tenant.surveyFlowId) {
        surveyFlowId = tenant.surveyFlowId;
      }

      const flows = tenant?.flows || {};
      const surveyFlow = surveyFlowId ? flows.uras?.[surveyFlowId] : null;

      if (surveyFlow) {
        // Redireciona para BOT para iniciar a pesquisa
        const updatedConversation = await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            status: 'BOT',
            flowState: {
              nodeId: 'start',
              step: 0,
              data: {},
              isSurvey: true,
              surveyFlowId
            }
          }
        });

        logger.info(`[TimeoutService] Conversa ${conv.id} redirecionada para pesquisa NPS por inatividade`, {
          surveyFlowId,
          tenantId: conv.tenantId
        });

        const FlowEngine = require('./FlowEngine');
        const freshConv = await prisma.conversation.findUnique({
          where: { id: conv.id },
          include: { contact: true }
        });

        FlowEngine.executeNode(tenant, freshConv, surveyFlow, updatedConversation.flowState, null).catch(err => {
          logger.error('[TimeoutService] Erro ao executar primeiro nó de pesquisa por inatividade:', err.message);
        });

        const io = socketService.getIO();
        if (io) {
          io.to(`tenant:${conv.tenantId}`).emit('conversation_resolved', {
            conversationId: conv.id,
            contactPhone: conv.contact.phone,
            contactName: conv.contact.name,
            disposition: 'Enviado para Pesquisa (Inatividade)',
            resolvedBy: 'sistema',
            resolvedAt: new Date().toISOString()
          });
        }

        QueueService.processQueue(conv.tenantId).catch(err => {
          logger.error(`[TimeoutService] Erro ao reprocessar fila do tenant ${conv.tenantId} após desvio NPS:`, err.message);
        });

        return;
      }

      // Update Conversation to RESOLVED with disposition 'Sistema'
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          status: 'RESOLVED',
          flowState: null,
          disposition: 'Sistema',
          closingNotes: 'Encerrada por inatividade pelo sistema'
        }
      });

      // Dispara webhook de fechamento/resolução para CRM externo
      const CloseWebhookService = require('./CloseWebhookService');
      CloseWebhookService.trigger(conv.id).catch(err => {
        logger.error(`[TimeoutService] CloseWebhook trigger failed for conversation ${conv.id}:`, err.message);
      });

      // Enfileirar para IA se o recurso estiver habilitado
      if (tenant?.featureAiSummary) {
        const { enqueueConversation } = require('../queues/aiQueue');
        enqueueConversation(conv.id);
      }

      // Emit socket event to the tenant room
      const io = socketService.getIO();
      if (io) {
        io.to(`tenant:${conv.tenantId}`).emit('conversation_resolved', {
          conversationId: conv.id,
          contactPhone: conv.contact.phone,
          contactName: conv.contact.name,
          disposition: 'Sistema',
          resolvedBy: 'sistema',
          resolvedAt: new Date().toISOString()
        });
      }

      // Process Queue async (since an agent might be free now)
      QueueService.processQueue(conv.tenantId).catch(err => {
        logger.error(`[TimeoutService] Erro ao reprocessar fila do tenant ${conv.tenantId} após expiração:`, err.message);
      });

    } catch (e) {
      logger.error(`[TimeoutService] Erro ao expirar conversa ${conv.id}:`, e.message);
    }
  }

  static async sendQueueAlertNotification(tenant, conv, waitMinutes, notificationType, target) {
    try {
      if (notificationType === 'WEBHOOK') {
        const axios = require('axios');
        const payload = {
          event: 'queue_delay_alert',
          tenantId: tenant.id,
          tenantName: tenant.name,
          conversationId: conv.id,
          contactId: conv.contactId,
          contactName: conv.contact.name || conv.contact.phone,
          contactPhone: conv.contact.phone,
          channel: conv.channel,
          waitMinutes: waitMinutes,
          timestamp: new Date().toISOString()
        };
        
        logger.debug('[QueueAlert] Disparando webhook para ' + target);
        await axios.post(target, payload, { timeout: 10000 });
        logger.info('[QueueAlert] Webhook de alerta disparado com sucesso.');
      } else if (notificationType === 'EMAIL') {
        const nodemailer = require('nodemailer');
        
        const host = process.env.SMTP_HOST;
        const port = parseInt(process.env.SMTP_PORT, 10) || 587;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        const from = process.env.SMTP_FROM || 'no-reply@broker.com.br';
        
        if (!host || !user || !pass) {
          logger.warn('[QueueAlert] SMTP não configurado no .env. Impossível enviar e-mail de alerta.');
          return;
        }
        
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass }
        });
        
        const mailOptions = {
          from,
          to: target,
          subject: `⚠️ Alerta de Fila - Broker (${tenant.name})`,
          text: `Atenção!\n\nExiste um cliente na fila de espera há mais de ${waitMinutes} minutos no Broker.\n\nDetalhes:\n- Cliente: ${conv.contact.name || conv.contact.phone}\n- Contato: ${conv.contact.phone}\n- Canal: ${conv.channel}\n- Tempo de Espera: ${waitMinutes} minutos\n\nPor favor, acesse o painel de atendimento para iniciar o suporte.`,
          html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px;">
            <h2 style="color: #dc2626; margin-top: 0;">⚠️ Alerta de Fila de Espera</h2>
            <p>Olá,</p>
            <p>Existe um cliente aguardando atendimento humano na fila há mais de <strong>${waitMinutes} minutos</strong> no Broker.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; width: 140px;"><strong>Cliente:</strong></td>
                <td style="padding: 6px 0; color: #1e293b;">${conv.contact.name || conv.contact.phone}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;"><strong>Contato / ID:</strong></td>
                <td style="padding: 6px 0; color: #1e293b;">${conv.contact.phone}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;"><strong>Canal:</strong></td>
                <td style="padding: 6px 0; color: #1e293b;"><span style="background: #e2e8f0; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: bold;">${conv.channel}</span></td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;"><strong>Tempo de Fila:</strong></td>
                <td style="padding: 6px 0; color: #1e293b; color: #dc2626;"><strong>${waitMinutes} minutos</strong></td>
              </tr>
            </table>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="margin-bottom: 0;"><a href="https://broker.amber.com.br" style="background: #01745e; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Acessar Painel Broker</a></p>
          </div>`
        };
        
        await transporter.sendMail(mailOptions);
        logger.info('[QueueAlert] E-mail de alerta de fila enviado com sucesso para: ' + target);
      }
    } catch (error) {
      logger.error('[QueueAlert] Erro ao enviar notificação de alerta:', error.message);
    }
  }
}

module.exports = ConversationTimeoutService;
