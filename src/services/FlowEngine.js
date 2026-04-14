const prisma = require('./database');
const whatsappService = require('./whatsapp');
const BusinessHoursService = require('./BusinessHoursService');
const SafeEvaluator = require('./SafeEvaluator');

// Constants
const MAX_FLOW_STEPS = 15;
const MAX_BUTTON_OPTIONS = 3;
const MAX_LIST_OPTIONS = 10;
const MAX_BUTTON_TITLE_LENGTH = 20;
const MAX_LIST_TITLE_LENGTH = 24;
const API_TIMEOUT_MS = 10000;

/**
 * FlowEngine V2 - Sistema de URA/Bot refinado
 *
 * Tipos de Nós Suportados:
 * - text: Envia mensagem simples e avança
 * - menu: Menu interativo com opções
 * - collect_data: Coleta informação do usuário
 * - conditional: Decisão baseada em dados
 * - transfer_agent: Transfere para agente/skill
 * - transfer_queue: Envia para fila
 * - api_call: Chamada HTTP externa
 * - set_data: Define variável
 * - end: Finaliza flow
 */
class FlowEngine {
  /**
   * Processa mensagem do usuário através do flow
   */
  static async process(tenant, conversation, message) {
    try {
      // 1. Re-fetch conversation with latest flowState from DB.
      // The object passed in may be stale if two messages arrived in quick succession.
      const fresh = await prisma.conversation.findUnique({
        where: { id: conversation.id }
      });
      if (!fresh) {
        console.warn(`[FlowEngine] Conversation ${conversation.id} not found in DB, skipping`);
        return;
      }
      conversation = fresh;

      // 2. Validar status
      if (conversation.status !== 'BOT') {
        console.log(
          `[FlowEngine] Conversation ${conversation.id} não está em modo BOT. Status: ${conversation.status}`
        );
        return;
      }

      // 2. Verificar horário comercial
      if (tenant.businessHours?.enabled) {
        const isOpen = BusinessHoursService.isWithinBusinessHours(tenant.businessHours);

        if (!isOpen) {
          if (tenant.businessHours.autoReplyEnabled) {
            const offlineMsg = BusinessHoursService.getOfflineMessage(tenant.businessHours);
            await FlowEngine.sendMessage(conversation, offlineMsg, tenant);
          }

          // Enfileirar para próximo horário
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              status: 'QUEUED',
              flowState: { officeHours: false, waitingForBusiness: true }
            }
          });
          return;
        }
      }

      // 3. Carregar configuração do flow
      const flows = tenant.flows || {};
      const activeFlowId = flows.active || 'Padrão';
      const flow = flows.uras?.[activeFlowId];

      if (!flow || !flow.start) {
        console.error('[FlowEngine] Flow não configurado ou inválido');
        await FlowEngine.sendMessage(
          conversation,
          'Olá! Um momento por favor, estou conectando você com um atendente.',
          tenant
        );
        await FlowEngine.transferToQueue(tenant, conversation, null);
        return;
      }

      // 4. Carregar/inicializar estado com validação robusta
      let state = conversation.flowState;

      if (!state || typeof state !== 'object') {
        console.warn('[FlowEngine] Invalid flowState detected, reinitializing');
        state = {
          nodeId: 'start',
          step: 0,
          data: {},
          history: []
        };
      } else {
        // Garantir que data sempre existe e é um objeto válido
        if (!state.data || typeof state.data !== 'object') {
          console.warn('[FlowEngine] Corrupted flowState.data, recovering...');
          state.data = state.data || {};
        }
        if (!state.history || !Array.isArray(state.history)) {
          state.history = [];
        }
      }

      // 5. Carregar dados do contato para interpolação - WITH TENANT SECURITY
      const contact = await prisma.contact.findUnique({
        where: { id: conversation.contactId }
      });

      if (!contact || contact.tenantId !== tenant.id) {
        console.error('[FlowEngine] SECURITY: Contact access denied - cross-tenant attempt', {
          contactId: conversation.contactId,
          contactTenantId: contact?.tenantId,
          requestedTenantId: tenant.id
        });
        await FlowEngine.sendMessage(
          conversation,
          'Erro de segurança: acesso negado. Por favor, contacte suporte.',
          tenant
        );
        await FlowEngine.transferToQueue(tenant, conversation, null);
        return;
      }

      if (!state.data) {
        state.data = {};
      }
      state.data.name = contact?.name || contact?.phone || 'Cliente';
      state.data.phone = contact?.phone;

      // 6. Primeira interação: executar nó inicial
      if (!state.waitingFor) {
        console.log('[FlowEngine] Primeira interação - executando nó start');
        await FlowEngine.executeNode(tenant, conversation, flow, state, message);
        return;
      }

      // 7. Processar resposta do usuário
      await FlowEngine.handleUserInput(tenant, conversation, flow, state, message);
    } catch (error) {
      console.error('[FlowEngine] Erro crítico:', error);
      await FlowEngine.sendMessage(
        conversation,
        'Desculpe, ocorreu um erro inesperado. Vou transferir você para um atendente.',
        tenant
      );
      await FlowEngine.transferToQueue(tenant, conversation, null);
    }
  }

  /**
   * Processa entrada do usuário baseado no estado atual
   */
  static async handleUserInput(tenant, conversation, flow, state, message) {
    // SECURITY: Validate message.content is not null/undefined
    if (!message || !message.content || typeof message.content !== 'string') {
      console.warn('[FlowEngine] Invalid message content received', {
        conversationId: conversation.id,
        messageType: typeof message?.content,
        hasContent: !!message?.content
      });
      await FlowEngine.sendMessage(
        conversation,
        'Desculpe, não consegui processar sua mensagem. Pode tentar novamente?',
        tenant
      );
      return;
    }

    const input = message.content.trim();

    // Check if message is empty after trim
    if (input.length === 0) {
      console.warn('[FlowEngine] Empty message received after trim');
      await FlowEngine.sendMessage(
        conversation,
        'Por favor, envie uma mensagem com conteúdo.',
        tenant
      );
      return;
    }

    const waitingType = state.waitingFor;

    console.log(`[FlowEngine] Processando input. Esperando: ${waitingType}, Input: ${input}`);

    // Coleta de dados
    if (waitingType === 'collect_data') {
      const dataKey = state.collectingKey;
      if (dataKey) {
        state.data[dataKey] = input;
        console.log(`[FlowEngine] Coletado ${dataKey}: ${input}`);

        // Validação se configurada
        if (state.validationPattern) {
          const regex = new RegExp(state.validationPattern);
          if (!regex.test(input)) {
            await FlowEngine.sendMessage(
              conversation,
              state.validationError || '❌ Formato inválido. Tente novamente.',
              tenant
            );
            return; // Mantém no mesmo estado
          }
        }
      }

      state.waitingFor = null;
      state.collectingKey = null;

      // Avançar para próximo nó
      const currentNode = flow[state.nodeId];
      if (currentNode?.next) {
        state.nodeId = currentNode.next;
        await FlowEngine.executeNode(tenant, conversation, flow, state, message);
      }
      return;
    }

    // Seleção de menu
    if (await FlowEngine.isMenuWaiting(state, flow)) {
      const currentNode = flow[state.nodeId];
      const nextNodeId = FlowEngine.findMenuOption(currentNode, input);

      if (nextNodeId) {
        // Opção válida selecionada
        state.history.push({ node: state.nodeId, input, timestamp: new Date() });
        state.nodeId = nextNodeId;
        state.waitingFor = null;
        state.step = (state.step || 0) + 1;

        await FlowEngine.executeNode(tenant, conversation, flow, state, message);
      } else {
        // Opção inválida
        await FlowEngine.sendMessage(
          conversation,
          '❌ Opção inválida. Por favor, escolha uma das opções disponíveis:',
          tenant
        );

        // Reenviar menu
        await FlowEngine.sendMenu(conversation, currentNode, state, tenant);
      }
    }
  }

  /**
   * Executa um nó do flow
   */
  static async executeNode(tenant, conversation, flow, state, message) {
    let nodeId = state.nodeId;
    let steps = 0;

    while (nodeId && steps < MAX_FLOW_STEPS) {
      steps++;

      const node = flow[nodeId];
      if (!node) {
        console.error(`[FlowEngine] Nó ${nodeId} não encontrado no flow`);
        await FlowEngine.sendMessage(
          conversation,
          'Ocorreu um erro no fluxo. Reiniciando...',
          tenant
        );
        state.nodeId = 'start';
        state.waitingFor = null;
        await FlowEngine.saveState(conversation, state);
        return;
      }

      console.log(`[FlowEngine] Executando nó: ${nodeId} (tipo: ${node.type})`);

      // Executar nó baseado no tipo
      const shouldContinue = await FlowEngine.executeNodeByType(
        tenant,
        conversation,
        flow,
        state,
        node,
        nodeId,
        message
      );

      if (!shouldContinue) {
        break; // Parar execução (aguardando input ou finalizado)
      }

      // Avançar para próximo nó
      if (node.next) {
        nodeId = node.next;
        state.nodeId = nodeId;
      } else {
        break; // Fim do flow
      }
    }

    // Salvar estado
    await FlowEngine.saveState(conversation, state);

    if (steps >= MAX_FLOW_STEPS) {
      console.warn('[FlowEngine] Atingiu limite de steps. Possível loop infinito.');
      await FlowEngine.transferToQueue(tenant, conversation, null);
    }
  }

  /**
   * Executa nó baseado no tipo
   * @returns {boolean} True se deve continuar, False se deve parar
   */
  static async executeNodeByType(tenant, conversation, flow, state, node, nodeId, message) {
    const type = node.type || 'text'; // Default: text

    switch (type) {
      case 'text':
      case 'auto':
        return await FlowEngine.handleTextNode(tenant, conversation, state, node);

      case 'menu':
        return await FlowEngine.handleMenuNode(tenant, conversation, state, node, nodeId);

      case 'collect_data':
        return await FlowEngine.handleCollectDataNode(tenant, conversation, state, node, nodeId);

      case 'conditional':
        return await FlowEngine.handleConditionalNode(tenant, conversation, flow, state, node);

      case 'transfer_agent':
      case 'transfer':
        return await FlowEngine.handleTransferNode(tenant, conversation, state, node);

      case 'transfer_queue':
        return await FlowEngine.handleQueueNode(tenant, conversation, state, node);

      case 'api_call':
        return await FlowEngine.handleApiCallNode(tenant, conversation, state, node);

      case 'set_data':
        return await FlowEngine.handleSetDataNode(state, node);

      case 'end':
        await FlowEngine.sendMessage(
          conversation,
          FlowEngine.interpolate(node.message || 'Obrigado!', state),
          tenant
        );
        await FlowEngine.closeConversation(conversation);
        return false;

      default:
        console.warn(`[FlowEngine] Tipo de nó desconhecido: ${type}`);
        return true; // Continuar para próximo
    }
  }

  /**
   * Nó de texto simples
   */
  static async handleTextNode(tenant, conversation, state, node) {
    const text = FlowEngine.interpolate(node.message || '', state);
    await FlowEngine.sendMessage(conversation, text, tenant);
    return true; // Continuar
  }

  /**
   * Nó de menu interativo
   */
  static async handleMenuNode(tenant, conversation, state, node, nodeId) {
    await FlowEngine.sendMenu(conversation, node, state, tenant);

    // Parar e aguardar seleção
    state.waitingFor = nodeId;
    return false;
  }

  /**
   * Nó de coleta de dados
   */
  static async handleCollectDataNode(tenant, conversation, state, node, nodeId) {
    const message = FlowEngine.interpolate(node.message || 'Por favor, informe:', state);
    await FlowEngine.sendMessage(conversation, message, tenant);

    // Configurar estado de coleta
    state.waitingFor = 'collect_data';
    state.collectingKey = node.data_key || 'input';
    state.validationPattern = node.validation_pattern;
    state.validationError = node.validation_error;

    return false; // Parar e aguardar input
  }

  /**
   * Nó condicional (if/else)
   */
  static async handleConditionalNode(tenant, conversation, flow, state, node) {
    const condition = node.condition; // Ex: "{{status}} === 'ok'"
    const conditionStr = FlowEngine.interpolate(condition, state);

    try {
      // Avaliar condição de forma segura
      const result = FlowEngine.evaluateCondition(conditionStr, state);

      if (result) {
        state.nodeId = node.if_true;
      } else {
        state.nodeId = node.if_false || node.next;
      }

      return true; // Continuar para nó condicional
    } catch (error) {
      console.error('[FlowEngine] Erro ao avaliar condição:', error);
      return true; // Continuar para next
    }
  }

  /**
   * Nó de transferência para agente/skill
   */
  static async handleTransferNode(tenant, conversation, state, node) {
    const message = FlowEngine.interpolate(
      node.message || 'Transferindo para um atendente...',
      state
    );
    await FlowEngine.sendMessage(conversation, message, tenant);

    const skillName = node.dept || node.skill;
    const success = await FlowEngine.assignAgent(tenant, conversation, skillName);

    if (!success) {
      await FlowEngine.sendMessage(
        conversation,
        'Todos os atendentes estão ocupados. Você está na fila de espera.',
        tenant
      );
      // CRITICAL: Fallback to queue so the conversation leaves BOT status.
      // Without this, the next user message would re-enter the flow from stale state
      // and produce wrong/repeated messages.
      await FlowEngine.transferToQueue(tenant, conversation, skillName);
    }

    return false; // Parar flow
  }

  /**
   * Nó de transferência para fila
   */
  static async handleQueueNode(tenant, conversation, state, node) {
    const message = FlowEngine.interpolate(node.message || 'Aguarde na fila, por favor.', state);
    await FlowEngine.sendMessage(conversation, message, tenant);

    await FlowEngine.transferToQueue(tenant, conversation, node.dept);
    return false; // Parar flow
  }

  /**
   * Nó de chamada API
   */
  static async handleApiCallNode(tenant, conversation, state, node) {
    console.log(`[FlowEngine] Executando API Call: ${node.api_method || 'GET'} ${node.api_url}`);

    try {
      const url = FlowEngine.interpolate(node.api_url, state);
      const method = (node.api_method || 'GET').toUpperCase();

      // Interpolar headers (suporta variáveis como {{api_key}})
      const rawHeaders = node.api_headers || {};
      const headers = {};
      Object.entries(rawHeaders).forEach(([key, value]) => {
        headers[key] = FlowEngine.interpolate(String(value), state);
      });

      // Interpolar body (suporta variáveis como {{nome}}, {{telefone}})
      let body = undefined;
      if (node.api_body) {
        const bodyStr =
          typeof node.api_body === 'string' ? node.api_body : JSON.stringify(node.api_body);
        const interpolated = FlowEngine.interpolate(bodyStr, state);
        try {
          body = JSON.parse(interpolated);
        } catch (e) {
          console.error('[FlowEngine] Erro ao parsear body da API:', e.message);
          body = interpolated;
        }
      }

      const axios = require('axios');
      const response = await axios({
        method,
        url,
        headers,
        data: body,
        timeout: API_TIMEOUT_MS,
        validateStatus: (status) => status < 500 // Não lançar erro para 4xx
      });

      console.log(`[FlowEngine] API Response: ${response.status}`);

      // Salvar status code
      state.data['_api_status'] = response.status;

      // Salvar resposta em variável
      if (node.api_save_var) {
        state.data[node.api_save_var] = response.data;
      }

      // Disponibilizar campos específicos da resposta
      if (node.api_map_fields && typeof response.data === 'object') {
        Object.entries(node.api_map_fields).forEach(([key, path]) => {
          state.data[key] = FlowEngine.getNestedValue(response.data, path);
        });
      }

      // Mensagem de sucesso (opcional)
      if (node.on_success_message) {
        await FlowEngine.sendMessage(
          conversation,
          FlowEngine.interpolate(node.on_success_message, state),
          tenant
        );
      }

      // Nó seguinte em caso de sucesso (opcional, senão usa next)
      if (node.on_success_next) {
        state.nodeId = node.on_success_next;
      }
    } catch (error) {
      console.error('[FlowEngine] API Error:', error.message);
      state.data['_api_error'] = error.message;

      if (node.on_error_message) {
        await FlowEngine.sendMessage(
          conversation,
          FlowEngine.interpolate(node.on_error_message, state),
          tenant
        );
      }

      // Se tiver nó de fallback para erro
      if (node.on_error_next) {
        state.nodeId = node.on_error_next;
      }
    }

    return true; // Continuar
  }

  /**
   * Nó de definição de dados
   */
  static async handleSetDataNode(state, node) {
    const key = node.data_key;
    const value = FlowEngine.interpolate(node.data_value, state);

    if (key) {
      state.data[key] = value;
      console.log(`[FlowEngine] Set ${key} = ${value}`);
    }

    return true; // Continuar
  }

  /**
   * Envia menu interativo
   */
  static async sendMenu(conversation, node, state, tenant) {
    const bodyText = FlowEngine.interpolate(node.message || '', state);
    const options = node.options || {};
    const keys = Object.keys(options);

    if (keys.length === 0) {
      await FlowEngine.sendMessage(conversation, bodyText, tenant);
      return;
    }

    // Decidir formato baseado em quantidade e tamanho
    const useButtons =
      keys.length <= MAX_BUTTON_OPTIONS && keys.every((k) => k.length <= MAX_BUTTON_TITLE_LENGTH);

    const useList =
      !useButtons &&
      keys.length <= MAX_LIST_OPTIONS &&
      keys.every((k) => k.length <= MAX_LIST_TITLE_LENGTH);

    if (useButtons) {
      // Botões interativos
      const buttons = keys.map((k) => ({
        type: 'reply',
        reply: { id: k, title: k }
      }));

      const payload = {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons }
        }
      };

      await FlowEngine.sendMessage(conversation, payload, tenant);
    } else if (useList) {
      // Lista interativa
      const rows = keys.map((k) => ({
        id: k,
        title: k,
        description: ''
      }));

      const payload = {
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: node.header || 'Menu' },
          body: { text: bodyText },
          footer: { text: node.footer || 'Selecione uma opção' },
          action: {
            button: 'Ver Opções',
            sections: [
              {
                title: 'Opções',
                rows
              }
            ]
          }
        }
      };

      await FlowEngine.sendMessage(conversation, payload, tenant);
    } else {
      // Fallback: texto simples
      let text = bodyText + '\n\n';
      keys.forEach((opt, idx) => {
        text += `${idx + 1}. ${opt}\n`;
      });
      await FlowEngine.sendMessage(conversation, text, tenant);
    }
  }

  /**
   * Encontra opção do menu baseado no input do usuário
   */
  static findMenuOption(node, input) {
    if (!node.options) {
      return null;
    }

    const normalized = input.trim().toLowerCase();

    // 1. Match exato
    const exactMatch = Object.keys(node.options).find((k) => k.toLowerCase() === normalized);
    if (exactMatch) {
      return node.options[exactMatch];
    }

    // 2. Match por número (1, 2, 3...)
    const number = parseInt(normalized);
    if (!isNaN(number)) {
      const keys = Object.keys(node.options);
      if (number >= 1 && number <= keys.length) {
        return node.options[keys[number - 1]];
      }
    }

    // 3. Match parcial (contém)
    const partialMatch = Object.keys(node.options).find(
      (k) => k.toLowerCase().includes(normalized) || normalized.includes(k.toLowerCase())
    );
    if (partialMatch) {
      return node.options[partialMatch];
    }

    return null;
  }

  /**
   * Verifica se está aguardando seleção de menu
   */
  static async isMenuWaiting(state, flow) {
    if (!state.waitingFor) {
      return false;
    }

    const node = flow[state.waitingFor];
    return node && (node.type === 'menu' || !node.type);
  }

  /**
   * Encerra a conversa (nó end) - permite nova sessão BOT no próximo contato
   */
  static async closeConversation(conversation) {
    try {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: 'CLOSED',
          assignedToId: null,
          flowState: null
        }
      });
      console.log(
        `[FlowEngine] Conversa ${conversation.id} encerrada (CLOSED). Próximo contato iniciará novo fluxo.`
      );
    } catch (error) {
      console.error('[FlowEngine] Error closing conversation:', error);
      throw error;
    }
  }

  /**
   * Transfere para fila
   */
  static async transferToQueue(tenant, conversation, skillName) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'QUEUED',
        assignedToId: null,
        flowState: { dept: skillName }
      }
    });

    // Tentar processar fila imediatamente
    const QueueService = require('./QueueService');
    QueueService.processQueue(tenant.id).catch((err) =>
      console.error('[FlowEngine] Queue process error:', err)
    );
  }

  /**
   * Atribui agente com skill específica usando AgentStatusService
   */
  static async assignAgent(tenant, conversation, skillName) {
    console.log(`[FlowEngine] Buscando agente para skill: "${skillName}"`);

    // 1. Resolver skill ID se especificado
    let skillId = null;
    if (skillName) {
      const skill = await prisma.skill.findFirst({
        where: {
          tenantId: tenant.id,
          name: { equals: skillName, mode: 'insensitive' }
        }
      });

      if (skill) {
        skillId = skill.id;
      } else {
        console.log(`[FlowEngine] Skill "${skillName}" não encontrada`);
      }
    }

    // 2. Buscar agentes disponíveis usando AgentStatusService
    const AgentStatusService = require('./AgentStatusService');
    const agents = await AgentStatusService.getAvailableAgents(tenant.id, skillId);

    if (agents.length === 0) {
      console.log('[FlowEngine] Nenhum agente disponível');
      return false;
    }

    // 3. AgentStatusService já retorna ordenado por menos ocupado e com capacidade
    const agent = agents[0];

    // 4. Atribuir
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'ASSIGNED',
        assignedToId: agent.id
      }
    });

    console.log(`[FlowEngine] Atribuído para ${agent.name}`);

    // 5. Notificar via Socket.io - usar AMBOS os rooms
    try {
      const socketService = require('./socket');
      const io = socketService.getIO();

      if (io) {
        const contact = await prisma.contact.findUnique({
          where: { id: conversation.contactId }
        });

        // Tenant room: para atualizar dashboards
        io.to(`tenant:${tenant.id}`).emit('chat_assigned', {
          conversationId: conversation.id,
          agentId: agent.id,
          agentName: agent.name,
          contactPhone: contact?.phone
        });

        // Conversation room: agente pode já estar na sala se for reassign
        io.to(`conversation:${conversation.id}`).emit('bot_transfer', {
          conversationId: conversation.id,
          message: 'Conversa transferida do bot para agente'
        });
      }
    } catch (e) {
      console.error('[FlowEngine] Socket emit error:', e);
    }

    return true;
  }

  /**
   * Envia mensagem via WhatsApp
   */
  static async sendMessage(conversation, content, tenant) {
    try {
      // SECURITY: Validate contact access with tenantId
      const contact = await prisma.contact.findUnique({
        where: { id: conversation.contactId }
      });

      if (!contact) {
        console.error('[FlowEngine] Contact not found', {
          contactId: conversation.contactId,
          conversationId: conversation.id
        });
        return;
      }

      if (contact.tenantId !== tenant.id) {
        console.error('[FlowEngine] SECURITY: Contact cross-tenant access attempt blocked', {
          contactTenantId: contact.tenantId,
          requestedTenantId: tenant.id,
          contactId: contact.id
        });
        return;
      }

      console.log(`[FlowEngine] Enviando mensagem para ${contact.phone}`);

      await whatsappService.sendMessage(contact.phone, content, tenant);

      // Salvar no banco
      let dbContent = content;
      if (typeof content === 'object') {
        if (content.type === 'interactive') {
          dbContent = `[Interactive: ${content.interactive.type}] ${content.interactive.body.text}`;
        } else {
          dbContent = JSON.stringify(content);
        }
      }

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          content: dbContent,
          contentType: 'text',
          direction: 'OUTBOUND',
          status: 'SENT',
          senderId: null // Bot
        }
      });
    } catch (error) {
      console.error('[FlowEngine] Send Error:', error.message);
    }
  }

  /**
   * Salva estado do flow
   */
  static async saveState(conversation, state) {
    try {
      // Validate state before saving
      if (!state || typeof state !== 'object') {
        console.error('[FlowEngine] Invalid state object, cannot save', typeof state);
        return;
      }

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { flowState: state }
      });
    } catch (error) {
      console.error('[FlowEngine] Error saving state:', error);
      throw error;
    }
  }

  /**
   * Interpola variáveis no texto
   */
  static interpolate(text, state) {
    if (!text || typeof text !== 'string') {
      return text;
    }
    if (!state.data) {
      return text;
    }

    let result = text;

    // Substituir {{variavel}}
    Object.entries(state.data).forEach(([key, value]) => {
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), valueStr);
    });

    return result;
  }

  /**
   * Avalia condição de forma segura
   */
  static evaluateCondition(conditionStr, state) {
    try {
      // Normalizar operadores JS para SafeEvaluator
      let normalized = conditionStr
        .replace(/===/g, '==')
        .replace(/!==/g, '!=')
        .replace(/&&/g, ' and ')
        .replace(/\|\|/g, ' or ');

      // Substituir referências data.xxx por variáveis planas
      normalized = normalized.replace(/data\.([a-zA-Z0-9_]+)/g, 'data_$1');

      // Construir variáveis planas a partir de state.data
      const variables = {};
      if (state.data && typeof state.data === 'object') {
        for (const [key, value] of Object.entries(state.data)) {
          variables[`data_${key}`] = value;
          variables[key] = value;
        }
      }

      return SafeEvaluator.evaluate(normalized, variables);
    } catch (error) {
      console.error('[FlowEngine] Erro ao avaliar condição:', error.message);
      return false;
    }
  }

  /**
   * Obtém valor aninhado de objeto (ex: "user.address.city")
   */
  static getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

module.exports = FlowEngine;
