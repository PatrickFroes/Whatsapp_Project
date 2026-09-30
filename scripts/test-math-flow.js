const FlowEngine = require('../src/services/FlowEngine');
const SafeEvaluator = require('../src/services/SafeEvaluator');

// Mock simple logging and prisma to run without fully starting database
global.logger = {
  info: console.log,
  warn: console.log,
  error: console.error,
  debug: console.log
};

// Mock prisma for local runner
global.prisma = {
  user: { count: async () => 0 },
  conversation: { count: async () => 0 }
};

async function runTests() {
  console.log("🧪 [Math & Condition Test] Iniciando testes do FlowEngine 2.0...");

  // 1. Testar interpretador de matemática segura (handleMathOperationNode)
  const state = {
    data: {
      valor_total: 150.5,
      parcelas: 3
    }
  };

  const mathNode = {
    type: 'math_operation',
    target_variable: 'valor_parcela',
    expression: '({{valor_total}} * 1.1) / {{parcelas}}'
  };

  console.log("\n⚡ Teste 1: Executando cálculo matemático seguro...");
  await FlowEngine.handleMathOperationNode(state, mathNode);
  console.log(`- Expressão: "${mathNode.expression}"`);
  console.log(`- Resultado esperado: ((150.5 * 1.1) / 3) = 55.18333...`);
  console.log(`- Resultado obtido: ${state.data.valor_parcela}`);
  
  if (state.data.valor_parcela && Math.abs(state.data.valor_parcela - 55.18333) < 0.01) {
    console.log("✅ Teste 1 PASSOU!");
  } else {
    console.error("❌ Teste 1 FALHOU!");
  }

  // 2. Testar injeção perigosa no bloco de matemática
  const maliciousNode = {
    type: 'math_operation',
    target_variable: 'hacked',
    expression: 'console.log("HACKED") || 2 + 2'
  };
  
  console.log("\n⚡ Teste 2: Proteção de injeção de código (RCE) no bloco matemático...");
  await FlowEngine.handleMathOperationNode(state, maliciousNode);
  console.log(`- Expressão maliciosa: "${maliciousNode.expression}"`);
  console.log(`- Resultado obtido: ${state.data.hacked}`);
  
  if (state.data.hacked === undefined) {
    console.log("✅ Teste 2 PASSOU (Sanitização barrou RCE com segurança!)");
  } else {
    console.error("❌ Teste 2 FALHOU! RCE executado ou falhou em isolar a expressão.");
  }

  // 3. Testar motor de decisões dinâmicas com Query Builder (rules)
  const condState = {
    data: {
      'system.agents_online': 0,
      'system.queue_size': 15
    }
  };

  const condNode = {
    type: 'conditional',
    rules: [
      { left: '{{system.agents_online}}', op: '==', right: '0', join: 'and' },
      { left: '{{system.queue_size}}', op: '>', right: '10', join: 'and' }
    ],
    if_true: 'aviso_offline',
    if_false: 'encaminha_fila'
  };

  console.log("\n⚡ Teste 3: Avaliando condicional dinâmico (regras E/OU)...");
  
  await FlowEngine.handleConditionalNode({}, { id: 'test_conv' }, {}, condState, condNode);
  console.log(`- Regras: agents_online == 0 E queue_size > 10`);
  console.log(`- Destino esperado: 'aviso_offline'`);
  console.log(`- Destino obtido: ${condState.nodeId}`);

  if (condState.nodeId === 'aviso_offline') {
    console.log("✅ Teste 3 PASSOU!");
  } else {
    console.error("❌ Teste 3 FALHOU!");
  }

  // 4. Testar Roteamento por Horários (Time Routing)
  console.log("\n⚡ Teste 4: Testando Roteamento por Horários (Time Routing)...");
  
  const testFlows = {
    active: 'Padrão',
    timeRouting: {
      enabled: true,
      rules: [
        { flowId: 'fluxo_manha', start: '08:00', end: '16:00' },
        { flowId: 'fluxo_tarde', start: '16:00', end: '21:00' },
        { flowId: 'fluxo_noite', start: '21:00', end: '08:00' } // Cruza meia-noite!
      ]
    }
  };

  const mockNow = (hours, minutes) => {
    return {
      getHours: () => hours,
      getMinutes: () => minutes
    };
  };

  const originalDate = global.Date;
  
  // Teste A: 10:30 (deve cair no fluxo_manha)
  global.Date = class extends originalDate {
    constructor() { super(); return mockNow(10, 30); }
  };
  const flowA = FlowEngine.resolveTimeRoutingFlow(testFlows);
  console.log(`- Horário: 10:30 | Fluxo resolvido: ${flowA} (Esperado: fluxo_manha)`);

  // Teste B: 18:15 (deve cair no fluxo_tarde)
  global.Date = class extends originalDate {
    constructor() { super(); return mockNow(18, 15); }
  };
  const flowB = FlowEngine.resolveTimeRoutingFlow(testFlows);
  console.log(`- Horário: 18:15 | Fluxo resolvido: ${flowB} (Esperado: fluxo_tarde)`);

  // Teste C: 03:45 (deve cair no fluxo_noite - cruzando meia-noite!)
  global.Date = class extends originalDate {
    constructor() { super(); return mockNow(3, 45); }
  };
  const flowC = FlowEngine.resolveTimeRoutingFlow(testFlows);
  console.log(`- Horário: 03:45 | Fluxo resolvido: ${flowC} (Esperado: fluxo_noite)`);

  global.Date = originalDate;

  if (flowA === 'fluxo_manha' && flowB === 'fluxo_tarde' && flowC === 'fluxo_noite') {
    console.log("✅ Teste 4 PASSOU!");
  } else {
    console.error("❌ Teste 4 FALHOU!");
  }

  console.log("\n🎉 Todos os testes unitários do FlowEngine 2.0 foram concluídos!");
}

runTests().catch(console.error);
