const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

// Fila em memória
const queue = [];
let isProcessing = false;

/**
 * Mascara dados sensíveis no texto usando regex (LGPD)
 */
function maskSensitiveData(text) {
  if (!text) return '';
  let masked = text;
  // CPF: 000.000.000-00 ou 00000000000
  masked = masked.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF-REDACTED]');
  // E-mail
  masked = masked.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL-REDACTED]');
  // Cartão de crédito simples (16 dígitos)
  masked = masked.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD-REDACTED]');
  // Telefones (DD) 90000-0000 ou similares
  masked = masked.replace(/(\+?55\s?)?\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/g, '[PHONE-REDACTED]');
  return masked;
}

/**
 * Adiciona uma conversa para ser sumarizada
 */
function enqueueConversation(conversationId) {
  if (!conversationId) return;
  
  // Evitar duplicidade na fila
  if (queue.includes(conversationId)) {
    logger.warn(`[AI Queue] Conversa ${conversationId} já está na fila.`);
    return;
  }
  
  queue.push(conversationId);
  logger.warn(`[AI Queue] Conversa ${conversationId} adicionada à fila. Posição: ${queue.length}`);
  
  // Iniciar processamento se estiver parado
  triggerProcessor();
}

/**
 * Dispara o processador da fila
 */
async function triggerProcessor() {
  if (isProcessing) return;
  isProcessing = true;
  
  while (queue.length > 0) {
    const conversationId = queue.shift();
    try {
      await processConversation(conversationId);
    } catch (err) {
      logger.error(`[AI Queue] Erro ao processar conversa ${conversationId}:`, err);
    }
  }
  
  isProcessing = false;
}

/**
 * Processa a IA para uma conversa individual
 */
async function processConversation(conversationId) {
  logger.warn(`[AI Queue] Iniciando processamento da conversa ${conversationId}`);
  
  try {
    // 1. Obter a conversa e as últimas 60 mensagens
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 60
        }
      }
    });
    
    if (!conversation) {
      logger.warn(`[AI Queue] Conversa ${conversationId} não encontrada.`);
      return;
    }
    
    if (!conversation.messages || conversation.messages.length === 0) {
      logger.warn(`[AI Queue] Conversa ${conversationId} não possui mensagens para analisar.`);
      // Salva valores vazios por segurança
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          aiSummary: "Sem histórico de mensagens.",
          aiSentiment: "NEUTRO",
          aiTags: []
        }
      });
      return;
    }
    
    // 2. Formatar o histórico mascarando dados sensíveis
    const historyText = conversation.messages.map(m => {
      const sender = m.direction === 'INBOUND' ? 'Cliente' : 'Atendente';
      const content = maskSensitiveData(m.content);
      return `${sender}: ${content}`;
    }).join('\n');
    
    // 3. Montar chamada ao Ollama baseado no .env
    const provider = process.env.AI_PROVIDER || 'ollama';
    const endpoint = process.env.AI_ENDPOINT || 'http://localhost:11434';
    const modelName = process.env.AI_MODEL || 'qwen2.5:3b';
    
    logger.warn(`[AI Queue] Enviando histórico de ${conversation.messages.length} mensagens para o provedor: ${provider}`);
    
    let summary = '';
    let sentiment = 'NEUTRO';
    let tags = [];
    
    if (provider === 'ollama') {
      const prompt = `Você é um assistente de auditoria de atendimento em português. Analise o histórico de conversa abaixo entre o Atendente e o Cliente.
Responda ESTRITAMENTE em formato JSON puro, sem textos adicionais antes ou depois do JSON. O JSON deve conter exatamente esta estrutura de chaves:
{
  "summary": "Um resumo claro e conciso de duas frases sobre o atendimento",
  "sentiment": "MUITO_POSITIVO" ou "POSITIVO" ou "NEUTRO" ou "NEGATIVO" ou "MUITO_NEGATIVO",
  "tags": ["assunto1", "assunto2", "assunto3"]
}

Histórico da Conversa:
${historyText}`;

      const authUser = process.env.AI_AUTH_USER;
      const authPass = process.env.AI_AUTH_PASS;

      const axiosConfig = {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 30000 // 30 segundos timeout
      };

      if (authUser && authPass) {
        axiosConfig.auth = {
          username: authUser,
          password: authPass
        };
      }

      const response = await axios.post(`${endpoint}/api/generate`, {
        model: modelName,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3
        }
      }, axiosConfig);
      
      const aiText = response.data?.response;
      if (!aiText) throw new Error("Resposta da IA vazia.");
      
      // 4. Parse do JSON de resposta (usando Regex para extrair chaves caso a IA responda com texto extra)
      try {
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("JSON não encontrado na resposta.");
        
        const parsed = JSON.parse(jsonMatch[0]);
        summary = parsed.summary || '';
        sentiment = (parsed.sentiment || 'NEUTRO').toUpperCase();
        tags = Array.isArray(parsed.tags) ? parsed.tags : [];
        
        // Validar sentimento
        if (!['MUITO_POSITIVO', 'POSITIVO', 'NEUTRO', 'NEGATIVO', 'MUITO_NEGATIVO'].includes(sentiment)) {
          sentiment = 'NEUTRO';
        }
      } catch (e) {
        logger.error(`[AI Queue] Falha no parse do JSON da IA: ${aiText}`, e);
        // Fallback se falhar parse
        summary = aiText.substring(0, 200);
        sentiment = 'NEUTRO';
      }
    } else {
      throw new Error(`Provedor de IA desconhecido: ${provider}`);
    }
    
    // 5. Salvar resultado no banco de dados
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        aiSummary: summary,
        aiSentiment: sentiment,
        aiTags: tags
      }
    });
    
    logger.warn(`[AI Queue] Conversa ${conversationId} sumarizada com sucesso! Sentimento: ${sentiment}`);
    
  } catch (err) {
    logger.error(`[AI Queue] Falha catastrófica ao processar conversa ${conversationId}:`, err);
    
    // Grava fallback de erro no banco
    try {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          aiSummary: "Falha ao gerar resumo da IA.",
          aiSentiment: "NEUTRO",
          aiTags: []
        }
      });
    } catch (dbErr) {
      logger.error(`[AI Queue] Falha ao gravar fallback de erro no banco:`, dbErr);
    }
  }

  // 6. Notificar via socket sobre a atualização da IA (Supervisor/Painel)
  try {
    const socketService = require('../services/socket');
    const io = socketService.getIO();
    if (io) {
      const finalConv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { aiSummary: true, aiSentiment: true, aiTags: true, tenantId: true }
      });
      if (finalConv) {
        io.to(`tenant:${finalConv.tenantId}`).emit('conversation_ai_updated', {
          conversationId: conversationId,
          aiSummary: finalConv.aiSummary,
          aiSentiment: finalConv.aiSentiment,
          aiTags: finalConv.aiTags
        });
      }
    }
  } catch (socketErr) {
    logger.error(`[AI Queue] Erro ao emitir evento de socket pós IA: ${socketErr.message}`);
  }

  // 7. Disparar webhook de encerramento atualizado para o CRM do cliente
  try {
    const CloseWebhookService = require('../services/CloseWebhookService');
    CloseWebhookService.trigger(conversationId).catch(err => {
      logger.error(`[AI Queue] Erro ao disparar CloseWebhook pós IA: ${err.message}`);
    });
  } catch (webhookErr) {
    logger.error(`[AI Queue] Falha ao importar CloseWebhookService: ${webhookErr.message}`);
  }
}

module.exports = {
  enqueueConversation
};
