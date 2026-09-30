const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const logger = require('../utils/logger');

class CloseWebhookService {
  static async trigger(conversationId) {
    try {
      if (!conversationId) return;

      // 1. Busca conversa com mensagens e contato
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          contact: true,
          tenant: {
            select: {
              id: true,
              name: true,
              closeWebhookConfig: true
            }
          },
          messages: {
            orderBy: { createdAt: 'asc' }
          }
        }
      });

      if (!conv || !conv.tenant) {
        logger.debug(`[CloseWebhook] Conversa ${conversationId} ou Tenant não encontrados.`);
        return;
      }

      const tenant = conv.tenant;
      const config = tenant.closeWebhookConfig;

      // 2. Valida se a configuração está ativa e possui URL
      if (!config || typeof config !== 'object' || !config.enabled) {
        logger.debug(`[CloseWebhook] Webhook de encerramento desativado para o tenant ${tenant.name}`);
        return;
      }

      const url = config.url ? config.url.trim() : '';
      if (!url) {
        logger.warn(`[CloseWebhook] Webhook de encerramento ativo no tenant ${tenant.name}, mas sem URL configurada.`);
        return;
      }

      // 3. Busca todos os usuários do tenant para mapear o nome dos agentes que mandaram mensagens
      const users = await prisma.user.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, name: true, role: true }
      });

      const userMap = new Map();
      users.forEach(u => userMap.set(u.id, u.name || 'Agente'));

      // 4. Formata o histórico cronológico de mensagens no padrão esperado pelo CRM
      const formattedMessages = conv.messages.map(m => {
        let senderType = 'bot'; // default fallback
        let senderName = 'Sistema';

        if (m.direction === 'INBOUND') {
          senderType = 'visitor';
          senderName = conv.contact.name || conv.contact.phone || 'Visitante';
        } else {
          // OUTBOUND
          if (m.senderId) {
            senderType = 'agent';
            senderName = userMap.get(m.senderId) || 'Agente';
          } else {
            senderType = 'bot';
            senderName = 'URA / Bot';
          }
        }

        return {
          id: String(m.id),
          sender: senderType,
          sender_name: senderName,
          senderName: senderName,
          content: m.content || '',
          content_type: m.contentType || 'text',
          contentType: m.contentType || 'text',
          media_url: m.mediaUrl || null,
          mediaUrl: m.mediaUrl || null,
          timestamp: m.createdAt.toISOString()
        };
      });

      // 5. Monta o payload estruturado rico (compatível com a API /conversation e IAs)
      const payload = {
        event: 'chat_resolved',
        tenantId: tenant.id,
        tenant_id: tenant.id,
        tenantName: tenant.name,
        tenant_name: tenant.name,
        conversation: {
          id: conv.id,
          channel: conv.channel,
          initiationType: conv.initiationType,
          initiation_type: conv.initiationType,
          disposition: conv.disposition || 'RESOLVED',
          closingNotes: conv.closingNotes || null,
          closing_notes: conv.closingNotes || null,
          createdAt: conv.createdAt.toISOString(),
          created_at: conv.createdAt.toISOString(),
          resolvedAt: conv.resolvedAt ? conv.resolvedAt.toISOString() : new Date().toISOString(),
          resolved_at: conv.resolvedAt ? conv.resolvedAt.toISOString() : new Date().toISOString(),
          surveyResponses: conv.surveyResponses || null,
          survey_responses: conv.surveyResponses || null,
          aiSummary: conv.aiSummary || null,
          ai_summary: conv.aiSummary || null,
          aiSentiment: conv.aiSentiment || null,
          ai_sentiment: conv.aiSentiment || null,
          aiTags: conv.aiTags || [],
          ai_tags: conv.aiTags || []
        },
        contact: {
          id: String(conv.contact.id),
          name: conv.contact.name || '',
          phone: String(conv.contact.phone),
          email: conv.contact.email || ''
        },
        messages: formattedMessages
      };

      // 6. Envia o POST HTTP para a API do CRM
      logger.warn(`[CloseWebhook] [API Encerramento] Disparando para: POST ${url} (Conv: ${conv.id})`);
      
      const headers = {
        'Content-Type': 'application/json',
      };

      if (config.secretToken) {
        const token = config.secretToken.trim();
        headers['API-KEY'] = token;
        headers['api-key'] = token;
        headers['X-Broker-Secret'] = token;
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await axios.post(url, payload, { 
        headers,
        timeout: 10000 // 10 segundos max
      });

      logger.warn(`[CloseWebhook] [API Encerramento Sucesso] Status: ${response.status} | Conversa ${conv.id} sincronizada no CRM.`);

    } catch (err) {
      logger.error(`[CloseWebhook] [API Encerramento Erro] Falha ao enviar conversa ${conversationId}: ${err.message}`);
      if (err.response) {
        const respSample = typeof err.response.data === 'object' ? JSON.stringify(err.response.data).substring(0, 300) : String(err.response.data).substring(0, 300);
        logger.error(`[CloseWebhook] [API Encerramento Resposta Erro] Status: ${err.response.status} | Body: ${respSample}`);
      }
    }
  }
}

module.exports = CloseWebhookService;
