const logger = require('../utils/logger');
const prisma = require('./database');
const whatsappService = require('./whatsapp');
const BusinessHoursService = require('./BusinessHoursService');
const SafeEvaluator = require('./SafeEvaluator');

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

function getParsedFlowState(flowState) {
  if (!flowState) return {};
  if (typeof flowState === 'object') return flowState;
  if (typeof flowState === 'string') {
    try {
      return JSON.parse(flowState);
    } catch (e) {
      return {};
    }
  }
  return {};
}

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
        logger.warn(`[FlowEngine] Conversation ${conversation.id} not found in DB, skipping`);
        return;
      }
      conversation = fresh;

      // 2. Validar status
      if (conversation.status !== 'BOT') {
        logger.debug(
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

      // 4. Carregar/inicializar estado com validação robusta
      let state = conversation.flowState;
      if (typeof state === 'string') {
        try {
          state = JSON.parse(state);
        } catch (e) {
          state = null;
        }
      }

      if (!state || typeof state !== 'object') {
        logger.warn('[FlowEngine] Invalid flowState detected, reinitializing');
        state = {
          nodeId: 'start',
          step: 0,
          data: {},
          history: []
        };
      } else {
        // Garantir que data sempre existe e é um objeto válido
        if (!state.data || typeof state.data !== 'object') {
          logger.warn('[FlowEngine] Corrupted flowState.data, recovering...');
          state.data = state.data || {};
        }
        if (!state.history || !Array.isArray(state.history)) {
          state.history = [];
        }
      }

      // 3. Carregar configuração do flow (ou do survey se estiver em modo pesquisa)
      const flows = tenant.flows || {};
      let activeFlowId = state.currentFlowId;
      if (!activeFlowId) {
        activeFlowId = FlowEngine.resolveTimeRoutingFlow(flows);
        state.currentFlowId = activeFlowId;
      }
      if (state.isSurvey && state.surveyFlowId) {
        activeFlowId = state.surveyFlowId;
      }
      const flow = flows.uras?.[activeFlowId];

      if (!flow || !flow.start) {
        logger.error('[FlowEngine] Flow não configurado ou inválido');
        await FlowEngine.sendMessage(
          conversation,
          'Olá! Um momento por favor, estou conectando você com um atendente.',
          tenant
        );
        await FlowEngine.transferToQueue(tenant, conversation, null);
        return;
      }

      // 5. Carregar dados do contato para interpolação - WITH TENANT SECURITY
      const contact = await prisma.contact.findUnique({
        where: { id: conversation.contactId }
      });

      if (!contact || contact.tenantId !== tenant.id) {
        logger.error('[FlowEngine] SECURITY: Contact access denied - cross-tenant attempt', {
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
      // Legados
      state.data.name = contact?.name || contact?.phone || 'Cliente';
      state.data.phone = contact?.phone;
      state.data.number = contact?.phone || '';
      state.data.username = contact?.name || '';

      // Variáveis Reservadas do Sistema (Carregamento Dinâmico em Tempo Real)
      const now = new Date();
      state.data['sys.date'] = now.toLocaleDateString('pt-BR');
      state.data['sys.time'] = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      state.data['sys.year'] = String(now.getFullYear());
      state.data['sys.conversation_id'] = conversation.id;
      state.data['sys.initiation_type'] = conversation.initiationType || 'INBOUND';
      state.data['sys.tenant_name'] = tenant.name || '';
      state.data['sys.tenant_id'] = tenant.id;
      state.data['sys.number'] = contact?.phone || '';
      state.data['sys.username'] = contact?.name || '';

      // Consultas de infraestrutura em tempo real
      const [agentsOnline, totalQueue] = await Promise.all([
        prisma.user.count({
          where: { tenantId: tenant.id, role: 'AGENT', workStatus: 'ONLINE', active: true }
        }),
        prisma.conversation.count({
          where: { tenantId: tenant.id, status: 'QUEUED' }
        })
      ]);

      state.data['system.agents_online'] = agentsOnline;
      state.data['system.queue_size'] = totalQueue;

      // Estatísticas específicas por Skill/Departamento da conversa atual
      let deptAgentsOnline = 0;
      let deptQueueSize = 0;

      if (conversation.dept) {
        const [dAgents, dQueue] = await Promise.all([
          prisma.user.count({
            where: {
              tenantId: tenant.id,
              role: 'AGENT',
              workStatus: 'ONLINE',
              active: true,
              skills: {
                some: {
                  skill: {
                    name: conversation.dept
                  }
                }
              }
            }
          }),
          prisma.conversation.count({
            where: { tenantId: tenant.id, status: 'QUEUED', dept: conversation.dept }
          })
        ]);
        deptAgentsOnline = dAgents;
        deptQueueSize = dQueue;
      }

      state.data['system.dept_agents_online'] = deptAgentsOnline;
      state.data['system.dept_queue_size'] = deptQueueSize;

      // 6. Primeira interação: executar nó inicial
      if (!state.waitingFor) {
        logger.debug('[FlowEngine] Primeira interação - executando nó start');
        await FlowEngine.executeNode(tenant, conversation, flow, state, message);
        return;
      }

      // 7. Processar resposta do usuário
      await FlowEngine.handleUserInput(tenant, conversation, flow, state, message);
    } catch (error) {
      logger.error('[FlowEngine] Erro crítico:', error);
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
      logger.warn('[FlowEngine] Invalid message content received', {
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
      logger.warn('[FlowEngine] Empty message received after trim');
      await FlowEngine.sendMessage(
        conversation,
        'Por favor, envie uma mensagem com conteúdo.',
        tenant
      );
      return;
    }

    const waitingType = state.waitingFor;

    logger.debug(`[FlowEngine] Processando input. Esperando: ${waitingType}, Input: ${input}`);

    // Coleta de dados
    if (waitingType === 'collect_data') {
      const dataKey = state.collectingKey;
      const dataType = state.collectingType || 'string';
      if (dataKey) {
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

        const castedValue = FlowEngine.castValue(input, dataType);
        state.data[dataKey] = castedValue;
        logger.debug(`[FlowEngine] Coletado ${dataKey} (${dataType}): ${JSON.stringify(castedValue)}`);
      }

      state.waitingFor = null;
      state.collectingKey = null;
      state.collectingType = null;

      // Avançar para próximo nó
      const currentNode = flow[state.nodeId];
      if (currentNode?.next) {
        state.nodeId = currentNode.next;
        await FlowEngine.executeNode(tenant, conversation, flow, state, message);
      } else {
        if (state.isSurvey) {
          await FlowEngine.finishSurvey(tenant, conversation, state);
        }
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
        logger.error(`[FlowEngine] Nó ${nodeId} não encontrado no flow`);
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

      logger.debug(`[FlowEngine] Executando nó: ${nodeId} (tipo: ${node.type})`);

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

    // Verificações de conclusão da pesquisa (Survey)
    if (state.isSurvey && (state.finished || !nodeId || !flow[nodeId])) {
      await FlowEngine.finishSurvey(tenant, conversation, state);
      return;
    }

    // Salvar estado
    await FlowEngine.saveState(conversation, state);

    if (steps >= MAX_FLOW_STEPS) {
      logger.warn('[FlowEngine] Atingiu limite de steps. Possível loop infinito.');
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

      case 'math_operation':
        return await FlowEngine.handleMathOperationNode(state, node);

      case 'switch_flow':
        return await FlowEngine.handleSwitchFlowNode(tenant, conversation, state, node);

      case 'end':
        if (node.message && node.message.trim().length > 0) {
          await FlowEngine.sendMessage(
            conversation,
            FlowEngine.interpolate(node.message, state),
            tenant
          );
        }
        if (state.isSurvey) {
          state.finished = true;
        } else {
          await FlowEngine.closeConversation(conversation);
        }
        return false;

      default:
        logger.warn(`[FlowEngine] Tipo de nó desconhecido: ${type}`);
        return true; // Continuar para próximo
    }
  }

  /**
   * Nó de desvio de fluxo (muda a URA ativa do cliente)
   */
  static async handleSwitchFlowNode(tenant, conversation, state, node) {
    const targetFlowId = node.target_flow_id;
    if (!targetFlowId) {
      logger.warn(`[FlowEngine] switch_flow executado sem target_flow_id na conversa ${conversation.id}`);
      return true; // Continua para o next se houver, ou encerra
    }

    const flows = tenant.flows || {};
    const targetFlow = flows.uras?.[targetFlowId];
    if (!targetFlow) {
      logger.error(`[FlowEngine] switch_flow executado para fluxo inexistente "${targetFlowId}" na conversa ${conversation.id}`);
      return true;
    }

    logger.info(`[FlowEngine] Redirecionando conversa ${conversation.id} para o fluxo "${targetFlowId}"`);
    
    // Altera o fluxo ativo e reseta o nó para start
    state.currentFlowId = targetFlowId;
    state.nodeId = 'start';
    state.step = 0;
    
    // IMPORTANTE: Como mudamos o fluxo em memória, precisamos atualizar a referência do nó 'start'
    // Mas o loop superior de processamento vai continuar rodando e no próximo ciclo ele lê node = flow[nodeId].
    // Para que o loop superior veja o novo fluxo instantaneamente nesta mesma transação,
    // nós alteramos diretamente o nodeId do estado. O loop do process() vai avançar para node.next,
    // mas se o tipo for 'switch_flow', nós não temos node.next direto que faça sentido no novo fluxo.
    // Portanto, forçamos o loop a ler o novo fluxo. Para isso, o handleSwitchFlowNode retorna true,
    // mas antes nós alteramos o nodeId no estado. 
    // Vamos garantir que no loop do process() o fluxo seja carregado dinamicamente caso mude!
    // Para simplificar e evitar loops infinitos na mesma execução, vamos retornar FALSE e salvar o estado.
    // Assim, na próxima mensagem do cliente (ou se executarmos de forma assíncrona), ele roda no novo fluxo.
    // Mas pera! Se a URA for silenciosa (nós de ação seguidos de texto), queremos que rode imediatamente!
    // O melhor é retornar FALSE e disparar o executeNode imediatamente para o novo fluxo!
    
    // Vamos disparar a execução imediata em background para não travar:
    setTimeout(() => {
      FlowEngine.executeNode(tenant, conversation, targetFlow, state, { content: '' }).catch(err => {
        logger.error(`[FlowEngine] Erro ao executar nó inicial após switch_flow: ${err.message}`);
      });
    }, 50);

    return false; // Para a execução do ciclo atual, pois o setTimeout vai assumir a execução no novo fluxo
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
    state.collectingType = node.data_type || 'string';
    state.validationPattern = node.validation_pattern;
    state.validationError = node.validation_error;

    return false; // Parar e aguardar input
  }

  /**
   * Nó condicional (if/else)
   */
  static async handleConditionalNode(tenant, conversation, flow, state, node) {
    let condition = node.condition; // Fallback para legados

    // Se o usuário configurou regras dinâmicas no frontend
    if (Array.isArray(node.rules) && node.rules.length > 0) {
      const parts = [];
      node.rules.forEach((rule, idx) => {
        const left = rule.left || '';
        const op = rule.op || '==';
        const right = rule.right || '';
        const join = rule.join || 'and'; // 'and' ou 'or' para conectar com a anterior

        // O operando esquerdo geralmente é uma variável (ex: {{system.agents_online}}).
        // O operando direito pode ser outra variável (ex: {{cliente.limite}}) ou um valor fixo.
        // Se o operando direito for numérico ou boleano ou já tiver chaves {{}}, colocamos puro.
        // Se for string pura, encapsulamos em aspas simples.
        let safeRight = right;
        if (
          typeof right === 'string' &&
          !right.startsWith('{{') &&
          isNaN(Number(right)) &&
          right !== 'true' &&
          right !== 'false' &&
          !right.startsWith("'") &&
          !right.startsWith('"')
        ) {
          safeRight = `'${right.replace(/'/g, "\\'")}'`;
        }

        const conditionPart = `(${left} ${op} ${safeRight})`;
        
        if (idx === 0) {
          parts.push(conditionPart);
        } else {
          const operatorStr = join === 'or' ? '||' : '&&';
          parts.push(` ${operatorStr} ${conditionPart}`);
        }
      });
      condition = parts.join('');
    }

    if (!condition) {
      logger.warn(`[FlowEngine] Nó condicional sem condição definida na conversa ${conversation.id}`);
      state.nodeId = node.if_false || node.next;
      return true;
    }

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
      logger.error('[FlowEngine] Erro ao avaliar condição:', error);
      state.nodeId = node.if_false || node.next;
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
    state.dept = skillName; // Sincroniza estado em memória para evitar que saveState sobrescreva e apague a skill
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

    state.dept = node.dept; // Sincroniza estado em memória
    await FlowEngine.transferToQueue(tenant, conversation, node.dept);
    return false; // Parar flow
  }

  /**
   * Nó de chamada API
   */
  static async handleApiCallNode(tenant, conversation, state, node) {
    logger.warn(`[FlowEngine] [API Call] Iniciando: ${node.api_method || 'GET'} ${node.api_url} (Conv: ${conversation.id})`);

    try {
      const url = FlowEngine.interpolate(node.api_url, state);
      const method = (node.api_method || 'GET').toUpperCase();
      logger.warn(`[FlowEngine] [API Call] Executando: ${method} ${url}`);

      // Interpolar headers (suporta JSON string ou Objeto)
      let rawHeaders = node.api_headers || {};
      if (typeof rawHeaders === 'string') {
        const interpolatedHeaders = FlowEngine.interpolate(rawHeaders, state);
        try {
          rawHeaders = JSON.parse(interpolatedHeaders);
        } catch (e) {
          try {
            rawHeaders = JSON.parse(interpolatedHeaders.replace(/'/g, '"'));
          } catch (e2) {
            logger.warn('[FlowEngine] [API Call] Erro ao parsear api_headers como JSON:', e.message);
            rawHeaders = {};
          }
        }
      }

      const headers = {};
      if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
        Object.entries(rawHeaders).forEach(([key, value]) => {
          const cleanKey = FlowEngine.interpolate(String(key), state).trim();
          const cleanVal = FlowEngine.interpolate(String(value), state).trim();
          headers[cleanKey] = cleanVal;
        });
      }

      // Interpolar body (suporta variáveis como {{nome}}, {{telefone}})
      let body = undefined;
      if (node.api_body) {
        let bodyStr =
          typeof node.api_body === 'string' ? node.api_body : JSON.stringify(node.api_body);
        const interpolated = FlowEngine.interpolate(bodyStr, state);
        try {
          body = JSON.parse(interpolated);
        } catch (e) {
          // Tentar autocorreção de aspas simples para aspas duplas válidas em JSON
          try {
            const jsonFixed = interpolated.replace(/'/g, '"');
            body = JSON.parse(jsonFixed);
          } catch (e2) {
            logger.warn('[FlowEngine] [API Call] Body enviado como texto plano:', e.message);
            body = interpolated;
          }
        }
      }

      if (body) {
        logger.warn(`[FlowEngine] [API Request Body] ${typeof body === 'object' ? JSON.stringify(body) : body}`);
      }
      if (headers && Object.keys(headers).length > 0) {
        logger.warn(`[FlowEngine] [API Request Headers] ${JSON.stringify(headers)}`);
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

      const respDataSample = typeof response.data === 'object' ? JSON.stringify(response.data).substring(0, 300) : String(response.data).substring(0, 300);
      logger.warn(`[FlowEngine] [API Response] Status: ${response.status} | Data: ${respDataSample}`);

      // Salvar status code
      state.data['_api_status'] = response.status;

      // Salvar resposta em variável
      if (node.api_save_var) {
        state.data[node.api_save_var] = response.data;
        logger.warn(`[FlowEngine] [API Save] Resposta gravada em {{${node.api_save_var}}}`);
      }

      // Disponibilizar campos específicos da resposta (suporta JSON string ou Objeto)
      let mapFields = node.api_map_fields;
      if (typeof mapFields === 'string') {
        try {
          mapFields = JSON.parse(mapFields);
        } catch (e) {
          mapFields = {};
        }
      }

      if (mapFields && typeof mapFields === 'object' && !Array.isArray(mapFields) && typeof response.data === 'object') {
        Object.entries(mapFields).forEach(([key, path]) => {
          const val = FlowEngine.getNestedValue(response.data, path);
          state.data[key] = val;
          logger.warn(`[FlowEngine] [API Map] Mapeado: {{${key}}} (path: "${path}") = ${JSON.stringify(val)}`);
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
      logger.error(`[FlowEngine] [API Error] Falha na chamada HTTP para ${node.api_url}: ${error.message}`);
      if (error.response) {
        const errDataSample = typeof error.response.data === 'object' ? JSON.stringify(error.response.data).substring(0, 300) : String(error.response.data).substring(0, 300);
        logger.error(`[FlowEngine] [API Error Details] Status: ${error.response.status} | Body: ${errDataSample}`);
      }
      state.data['_api_error'] = error.message;
      state.data['_api_status'] = error.response?.status || 500;

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
   * Converte um valor bruto para o tipo especificado
   */
  static castValue(value, type) {
    if (value === null || value === undefined) return value;
    const strVal = String(value).trim();
    
    switch (type) {
      case 'int':
        const parsedInt = parseInt(strVal, 10);
        return isNaN(parsedInt) ? strVal : parsedInt;
      case 'float':
        const parsedFloat = parseFloat(strVal.replace(',', '.'));
        return isNaN(parsedFloat) ? strVal : parsedFloat;
      case 'date':
        const parsedDate = new Date(strVal);
        if (isNaN(parsedDate.getTime())) {
          // Tentar parse de formatos brasileiros comuns: DD/MM/AAAA ou DD/MM/AAAA HH:MM:SS
          const match = strVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
          if (match) {
            const [_, day, month, year, hour = '00', minute = '00', second = '00'] = match;
            const pad = (n) => n.padStart(2, '0');
            const isoStr = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
            const dateTry = new Date(isoStr);
            if (!isNaN(dateTry.getTime())) {
              return dateTry;
            }
          }
          return strVal;
        }
        return parsedDate;
      case 'boolean':
        return strVal === 'true' || strVal === '1' || strVal === 'yes' || strVal === 'sim';
      case 'json':
        try {
          return JSON.parse(strVal);
        } catch (e) {
          logger.warn(`[FlowEngine] Falha ao converter string para JSON: "${strVal}"`);
          return strVal;
        }
      case 'string':
      default:
        return value;
    }
  }

  /**
   * Nó de definição de dados
   */
  static async handleSetDataNode(state, node) {
    const key = node.data_key;
    const type = node.data_type || 'string';
    let value = FlowEngine.interpolate(node.data_value, state);

    if (key) {
      value = FlowEngine.castValue(value, type);
      state.data[key] = value;
      logger.debug(`[FlowEngine] Set ${key} (${type}) = ${JSON.stringify(value)}`);
    }

    return true; // Continuar
  }

  /**
   * Nó de operação matemática segura
   */
  static async handleMathOperationNode(state, node) {
    const key = node.target_variable;
    const expr = node.expression || '';
    
    if (!key) {
      logger.warn('[FlowEngine] math_operation executado sem target_variable');
      return true; // Continua
    }

    const interpolated = FlowEngine.interpolate(expr, state);
    
    // HIGIENIZAÇÃO ABSOLUTA: remove qualquer caractere que não seja número, ponto ou operadores matemáticos básicos
    const cleanExpr = interpolated.replace(/[^0-9\+\-\*\/\%\.\(\)\s]/g, '');

    if (cleanExpr.trim().length === 0) {
      logger.warn(`[FlowEngine] Expressão matemática vazia ou inválida após higienização: "${expr}"`);
      return true;
    }

    try {
      // Execução segura: apenas expressões aritméticas sanitizadas
      const calculator = new Function(`return (${cleanExpr});`);
      const result = calculator();
      
      if (typeof result === 'number' && !isNaN(result)) {
        state.data[key] = result;
        logger.info(`[FlowEngine] Cálculo de matemática: ${key} = ${cleanExpr} => ${result}`);
      } else {
        logger.warn(`[FlowEngine] Resultado de cálculo matemático não numérico: ${result}`);
      }
    } catch (e) {
      logger.error(`[FlowEngine] Erro ao calcular expressão matemática "${cleanExpr}": ${e.message}`);
    }

    return true; // Continuar
  }

  /**
   * Envia menu interativo
   */
  static async sendMenu(conversation, node, state, tenant) {
    const bodyText = FlowEngine.interpolate(node.message || '', state);
    const options = node.options || {};
    const keys = Object.keys(options).sort((a, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });

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
        if (/^\d+[\s.\-_]+/i.test(opt.trim())) {
          text += `${opt.trim()}\n`;
        } else {
          text += `${idx + 1}. ${opt}\n`;
        }
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
      logger.debug(
        `[FlowEngine] Conversa ${conversation.id} encerrada (CLOSED). Próximo contato iniciará novo fluxo.`
      );
    } catch (error) {
      logger.error('[FlowEngine] Error closing conversation:', error);
      throw error;
    }
  }

  /**
   * Transfere para fila
   */
  static async transferToQueue(tenant, conversation, skillName) {
    const fs = getParsedFlowState(conversation.flowState);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'QUEUED',
        assignedToId: null,
        dept: skillName,
        flowState: {
          ...fs,
          dept: skillName,
          waitingForBusiness: false,
          queuedAt: new Date().toISOString(),
          queueAlertSent: false
        }
      }
    });

    // Tentar processar fila imediatamente
    const QueueService = require('./QueueService');
    QueueService.processQueue(tenant.id).catch((err) =>
      logger.error('[FlowEngine] Queue process error:', err)
    );
  }

  /**
   * Atribui agente com skill específica usando AgentStatusService
   */
  static async assignAgent(tenant, conversation, skillName) {
    logger.debug(`[FlowEngine] Buscando agente para skill: "${skillName}"`);

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
        logger.debug(`[FlowEngine] Skill "${skillName}" não encontrada`);
      }
    }

    // 2. Buscar agentes disponíveis usando AgentStatusService
    const AgentStatusService = require('./AgentStatusService');
    const agents = await AgentStatusService.getAvailableAgents(tenant.id, skillId);

    if (agents.length === 0) {
      logger.debug('[FlowEngine] Nenhum agente disponível');
      return false;
    }

    // 3. AgentStatusService já retorna ordenado por menos ocupado e com capacidade
    const agent = agents[0];

    // 4. Atribuir
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'ASSIGNED',
        assignedToId: agent.id,
        dept: skillName,
        flowState: {
          ...getParsedFlowState(conversation.flowState),
          dept: skillName, // Salva a skill selecionada no fluxo
          waitingForBusiness: false
        }
      }
    });

    logger.debug(`[FlowEngine] Atribuído para ${agent.name}`);

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
      logger.error('[FlowEngine] Socket emit error:', e);
    }

    return true;
  }

  /**
   * Envia mensagem via canal correspondente
   */
  static async sendMessage(conversation, content, tenant) {
    try {
      // SECURITY: Validate contact access with tenantId
      const contact = await prisma.contact.findUnique({
        where: { id: conversation.contactId }
      });

      if (!contact) {
        logger.error('[FlowEngine] Contact not found', {
          contactId: conversation.contactId,
          conversationId: conversation.id
        });
        return;
      }

      if (contact.tenantId !== tenant.id) {
        logger.error('[FlowEngine] SECURITY: Contact cross-tenant access attempt blocked', {
          contactTenantId: contact.tenantId,
          requestedTenantId: tenant.id,
          contactId: contact.id
        });
        return;
      }

      if (conversation.channel === 'WEBCHAT') {
        logger.debug(`[FlowEngine] Enviando mensagem via Webchat para a conversa ${conversation.id}`);
        const WebchatSocketService = require('./WebchatSocketService');
        await WebchatSocketService.sendToClient(conversation.id, content);
      } else {
        logger.debug(`[FlowEngine] Enviando mensagem para ${contact.phone}`);
        await whatsappService.sendMessage(contact.phone, content, tenant);
      }

      // Salvar no banco
      let dbContent = content;
      if (typeof content === 'object' && content !== null) {
        if (conversation.channel === 'WEBCHAT') {
          dbContent = JSON.stringify(content);
        } else if (content.type === 'interactive') {
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
      logger.error('[FlowEngine] Send Error:', error.message);
    }
  }

  /**
   * Salva estado do flow
   */
  static async saveState(conversation, state) {
    try {
      // Validate state before saving
      if (!state || typeof state !== 'object') {
        logger.error('[FlowEngine] Invalid state object, cannot save', typeof state);
        return;
      }

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { flowState: state }
      });
    } catch (error) {
      logger.error('[FlowEngine] Error saving state:', error);
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

    // 1. Substituição direta case-sensitive
    Object.entries(state.data).forEach(([key, value]) => {
      const valueStr =
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'object'
            ? JSON.stringify(value)
            : value === null || value === undefined
              ? ''
              : String(value);
      // Escapa caracteres especiais de regex (como o ponto de sys.date)
      const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      result = result.replace(new RegExp(`{{${escapedKey}}}`, 'g'), valueStr);
    });

    // 2. Fallback case-insensitive e diagnóstico para variáveis não resolvidas
    const remainingTags = result.match(/{{([^{}]+)}}/g);
    if (remainingTags && remainingTags.length > 0) {
      remainingTags.forEach((tag) => {
        const varName = tag.replace(/^{{\s*|\s*}}$/g, '').trim();
        // Buscar no state.data ignorando maiúsculas/minúsculas
        const matchingKey = Object.keys(state.data).find(
          (k) => k.toLowerCase() === varName.toLowerCase()
        );

        if (matchingKey) {
          const val = state.data[matchingKey];
          const valStr =
            val instanceof Date
              ? val.toISOString()
              : typeof val === 'object'
                ? JSON.stringify(val)
                : val === null || val === undefined
                  ? ''
                  : String(val);
          result = result.replace(tag, valStr);
        } else {
          logger.warn(
            `[FlowEngine] [Interpolate Warning] Variável "${tag}" não encontrada no estado da conversa. Chaves disponíveis: [${Object.keys(state.data).join(', ')}]`
          );
        }
      });
    }

    return result;
  }

  /**
   * Avalia condição de forma segura
   */
  static evaluateCondition(conditionStr, state) {
    try {
      // Substituir referências data.xxx por variáveis planas
      let normalized = conditionStr.replace(/data\.([a-zA-Z0-9_]+)/g, 'data_$1');

      // Substituir pontos por sublinhados nas variáveis (ex: system.agents_online -> system_agents_online)
      // para evitar conflitos com o tokenizer do SafeEvaluator que proíbe pontos.
      normalized = normalized.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_]+)/g, '$1_$2');

      // Normalizar operadores JS para SafeEvaluator
      normalized = normalized
        .replace(/===/g, '==')
        .replace(/!==/g, '!=')
        .replace(/&&/g, ' and ')
        .replace(/\|\|/g, ' or ');

      // Construir variáveis planas a partir de state.data
      const variables = {};
      if (state.data && typeof state.data === 'object') {
        for (const [key, value] of Object.entries(state.data)) {
          const safeKey = key.replace(/\./g, '_');
          variables[`data_${safeKey}`] = value;
          variables[safeKey] = value;
        }
      }

      return SafeEvaluator.evaluate(normalized, variables);
    } catch (error) {
      logger.error('[FlowEngine] Erro ao avaliar condição:', error.message);
      return false;
    }
  }

  /**
   * Obtém valor aninhado de objeto (ex: "user.address.city")
   */
  static getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Finaliza a pesquisa de satisfação (Survey), salvando as respostas.
   */
  static async finishSurvey(tenant, conversation, state) {
    logger.info(`[FlowEngine] Pesquisa de satisfação finalizada para conversa ${conversation.id}`);

    const responses = {};
    if (state.data) {
      Object.entries(state.data).forEach(([key, val]) => {
        if (!key.startsWith('sys.') && !key.startsWith('system.') && !key.includes('.') && key !== 'name' && key !== 'phone' && key !== 'number' && key !== 'username') {
          responses[key] = val;
        }
      });
    }

    // Evitar referências circulares recarregando contact para o socket
    const freshConv = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: { contact: { select: { phone: true, name: true } } }
    });

    const currentDept = getDeptFromFlowState(conversation.flowState);

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'CLOSED',
        surveyResponses: responses,
        flowState: currentDept ? { dept: currentDept } : null
      }
    });

    // Enfileirar para IA se o recurso estiver habilitado
    if (tenant?.featureAiSummary) {
      try {
        const { enqueueConversation } = require('../queues/aiQueue');
        enqueueConversation(conversation.id);
      } catch (err) {
        logger.error(`[FlowEngine] Erro ao enfileirar para IA pós pesquisa: ${err.message}`);
      }
    }

    // Disparar webhook de encerramento para CRM externo
    try {
      const CloseWebhookService = require('./CloseWebhookService');
      CloseWebhookService.trigger(conversation.id).catch(err => {
        logger.error(`[FlowEngine] Erro ao disparar CloseWebhook pós pesquisa: ${err.message}`);
      });
    } catch (err) {
      logger.error(`[FlowEngine] Falha ao importar CloseWebhookService: ${err.message}`);
    }

    const socketService = require('./socket');
    const io = socketService.getIO();
    if (io) {
      io.to(`tenant:${conversation.tenantId}`).emit('conversation_resolved', {
        conversationId: conversation.id,
        contactPhone: freshConv.contact?.phone,
        contactName: freshConv.contact?.name,
        disposition: freshConv.disposition || 'Pesquisa Respondida',
        resolvedBy: 'sistema',
        resolvedAt: new Date().toISOString(),
        surveyResponses: responses
      });
    }

    const QueueService = require('./QueueService');
    QueueService.processQueue(conversation.tenantId).catch(err => {
      logger.error('[FlowEngine] Erro ao processar fila pós pesquisa:', err.message);
    });
  }

  static resolveTimeRoutingFlow(flows) {
    if (!flows || !flows.timeRouting || !flows.timeRouting.enabled || !Array.isArray(flows.timeRouting.rules)) {
      return flows?.active || 'Padrão';
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const rule of flows.timeRouting.rules) {
      if (!rule.flowId || !rule.start || !rule.end) continue;

      const [sh, sm] = rule.start.split(':').map(Number);
      const [eh, em] = rule.end.split(':').map(Number);
      
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;

      if (startMinutes > endMinutes) {
        // Cruza meia-noite (ex: 21:00 às 08:00)
        if (currentMinutes >= startMinutes || currentMinutes <= endMinutes) {
          return rule.flowId;
        }
      } else {
        // Intervalo padrão do mesmo dia (ex: 08:00 às 16:00)
        if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
          return rule.flowId;
        }
      }
    }

    return flows.active || 'Padrão';
  }
}

module.exports = FlowEngine;
