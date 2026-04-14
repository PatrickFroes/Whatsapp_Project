# Chatbot Implementation & Security Audit

**Audit Date**: 2026-03-04  
**Severity Levels**: CRITICAL (🔴), HIGH (🟠), MEDIUM (🟡)

---

## Executive Summary

Realizei uma auditoria completa da estrutura de chatbot, analisando:

- ✅ Fluxo de processamento de mensagens
- ✅ Transições de estado de conversas
- ✅ Isolamento multi-tenant
- ✅ Validações e tratamento de erros
- ✅ Services (FlowEngine, QueueService, AgentStatusService)
- ✅ Webhook integration
- ✅ Transfers e roteamento

Encontrei **9 problemas críticos**, dos quais **3 representam riscos de segurança**.

---

## Critical Issues (🔴)

### Issue #1: Cross-Tenant Contact Access in FlowEngine

**Severity**: 🔴 CRITICAL  
**Type**: Security - Multi-Tenant Isolation  
**Location**: `src/services/FlowEngine.js` lines 90, 713, 743

**Problem**:

```javascript
// ❌ Lines 90, 713, 743 - Falta tenantId explícito
const contact = await prisma.contact.findUnique({
  where: { id: conversation.contactId }
});
```

**Risk**:

- Se IDs de contatos forem sequenciais ou previsíveis
- Um tenant poderia ver dados de contato de outro tenant
- Violação de isolamento multi-tenant

**Solution**:

```javascript
// ✅ Adicionar validação
const contact = await prisma.contact.findUnique({
  where: {
    id: conversation.contactId,
    tenantId: tenant.id // SECURITY: Explicit tenant filter
  }
});

if (!contact || contact.tenantId !== tenant.id) {
  throw new Error('Contact access denied - tenant isolation violation');
}
```

**Where to Fix**:

1. Line 90 - `FlowEngine.process()` - Carregamento de estado
2. Line 713 - `FlowEngine.assignAgent()` - Socket.io notification
3. Line 743 - `FlowEngine.sendMessage()` - Envio de mensagem

---

### Issue #2: Null/Undefined Message Content Not Validated

**Severity**: 🔴 CRITICAL  
**Type**: Data Integrity - Runtime Error  
**Location**: `src/services/FlowEngine.js` line 123

**Problem**:

```javascript
// Line 123 - message.content pode ser undefined
const input = message.content.trim();
```

**Scenario**:

- Se webhook enviar mensagem vazia ou malformada
- `message.content` será `undefined`
- Causará: `TypeError: Cannot read properties of undefined (reading 'trim')`
- Conversa travada indefinidamente

**Solution**:

```javascript
// ✅ Validação defensiva
if (!message || !message.content || typeof message.content !== 'string') {
  console.warn('[FlowEngine] Invalid message content received');
  await FlowEngine.sendMessage(
    conversation,
    'Desculpe, não consegui processar sua mensagem. Tente novamente.',
    tenant
  );
  return;
}

const input = message.content.trim();

if (input.length === 0) {
  console.warn('[FlowEngine] Empty message received after trim');
  return;
}
```

---

### Issue #3: Uninitialized flowState.data

**Severity**: 🔴 CRITICAL  
**Type**: Runtime Error - State Management  
**Location**: `src/services/FlowEngine.js` lines 119-121

**Problem**:

```javascript
// Line 119-121: flowState pode estar corrompido
const state = conversation.flowState || {
  nodeId: 'start',
  step: 0,
  data: {}, // ← OK na primeira vez
  history: []
};

// Mas se flowState foi salvo como JSON corrompido:
if (!state.data) {
  state.data = {}; // ← Cria novo, perde histórico
}
```

**Scenario**:

- Conversa já processou 5 passos (data coletada)
- Erro ao salvar flowState
- Próxima mensagem reinicializa data = {}
- Data coletada perdida, flow reicializa do zero

**Solution**:

```javascript
// ✅ Validação e recuperação de estado
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
  // Garantir que data sempre existe
  if (!state.data || typeof state.data !== 'object') {
    console.warn('[FlowEngine] Corrupted flowState.data, recovering...');
    state.data = state.data || {}; // Preservar o máximo que puder
  }
  if (!state.history || !Array.isArray(state.history)) {
    state.history = [];
  }
}
```

---

## High-Risk Issues (🟠)

### Issue #4: Race Condition Between Message Save and Conversation Update

**Severity**: 🟠 HIGH  
**Type**: Concurrency - Data Consistency  
**Location**: `src/controllers/WebhookController.js` lines 218-232

**Problem**:

```javascript
// Line 216-232: Duas operações separadas
const savedMessage = await prisma.message.create({
  data: {
    conversationId: conversation.id,
    content
    // ... mais campos
  }
});

// ← RACE CONDITION: Se erro aqui, message criada mas conversation não atualizada

// 5. Update Conversation Metadata
await prisma.conversation.update({
  where: { id: conversation.id },
  data: {
    lastMessageAt: new Date(),
    unreadCount: { increment: 1 }
  }
});
```

**Risk**:

- Se erro na linha 231 (update), mensagem fica órfã
- `lastMessageAt` não atualizado
- `unreadCount` incorreto
- UI mostra mensagens antigas

**Solution**:

```javascript
// ✅ Transação Prisma para atomicidade
const [savedMessage, updatedConv] = await prisma.$transaction([
  prisma.message.create({
    data: {
      conversationId: conversation.id,
      content,
      contentType,
      direction: 'INBOUND',
      mediaUrl,
      mediaSize,
      mediaMimeType,
      mediaFilename,
      waId: msg.id
    }
  }),
  prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      unreadCount: { increment: 1 }
    }
  })
]);

// Ambas succedem ou ambas falham
```

---

### Issue #5: Missing tenantId Validation in Transfer

**Severity**: 🟠 HIGH  
**Type**: Security - Authorization  
**Location**: `src/services/TransferService.js` line 14

**Problem**:

```javascript
// Line 14: conversationId é buscado sem validação de tenantId
const conversation = await prisma.conversation.findUnique({
  where: { id: conversationId }
  // ❌ Não verificar se conversation.tenantId === requester's tenantId
});
```

**Risk**:

- User de Tenant A poderia transferir conversa de Tenant B
- Se IDs de conversa forem previsíveis (UUID incrementais)
- Violação de segurança multi-tenant

**Solution**:

```javascript
// ✅ Adicionar validação de tenantId
static async transfer(conversationId, toUserId, fromUserId = null, reason = null, notes = null, requesterTenantId) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId }
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // SECURITY: Validar que requester é do mesmo tenant
  if (conversation.tenantId !== requesterTenantId) {
    throw new Error('SECURITY: Cross-tenant transfer attempt detected');
  }

  // Resto da lógica...
}
```

---

### Issue #6: Undefined Skill in QueueService Assignment

**Severity**: 🟠 HIGH  
**Type**: Logic Error - Queue Processing  
**Location**: `src/services/QueueService.js` lines 27-36

**Problem**:

```javascript
// Lines 27-36: flowState.dept pode ser undefined ou string vazia
let targetSkill = null;
if (conversation.flowState && conversation.flowState.dept) {
  targetSkill = conversation.flowState.dept;
}

// Se targetSkill é string vazia "" ou undefined
const agent = await QueueService.findAvailableAgent(tenantId, targetSkill);
```

**Scenario**:

- Flow criou conversa mas não definiu `dept` no flowState
- targetSkill = undefined
- findAvailableAgent busca skill vazia
- Agora ninguém recebe a conversa - fica eternamente na fila

**Solution**:

```javascript
// ✅ Validar e usar fallback
let targetSkill = null;

if (conversation.flowState && conversation.flowState.dept) {
  const deptValue = conversation.flowState.dept?.trim();
  if (deptValue && deptValue.length > 0) {
    targetSkill = deptValue;
  } else {
    console.warn(`[QueueService] Invalid dept in flowState for ${conversation.id}`);
  }
}

// Se nenhuma skill específica, buscar agente geral
const agent = await QueueService.findAvailableAgent(tenantId, targetSkill);

if (!agent) {
  console.error(
    `[QueueService] No available agent for skill=${targetSkill}, conversation ${conversation.id} stays queued`
  );
  return; // Continua na fila
}

await QueueService.assign(conversation, agent);
```

---

### Issue #7: Unhandled Promise Rejection in FlowEngine.process()

**Severity**: 🟠 HIGH  
**Type**: Error Handling - Async  
**Location**: `src/controllers/WebhookController.js` lines 253-258

**Problem**:

```javascript
// Lines 255-258: Fire-and-forget sem catch
try {
  await FlowEngine.process(tenant, conversation, savedMessage);
} catch (err) {
  console.error('[Webhook] Bot Execution Failed:', err);
  // Log only - não há retry ou recovery
}
```

**Risk**:

- Se FlowEngine falhar silenciosamente
- Mensagem salva mas não processada
- Usuário não sabe que foi para fila ou não

**Solution**:

```javascript
// ✅ Melhor tratamento e logging
try {
  await FlowEngine.process(tenant, conversation, savedMessage);
} catch (err) {
  console.error('[Webhook] Bot Execution Failed:', {
    conversationId: conversation.id,
    contactPhone: contact?.phone,
    error: err.message,
    stack: err.stack
  });

  // Tentar fallback: enviar para fila
  try {
    const currentConv = await prisma.conversation.findUnique({
      where: { id: conversation.id }
    });

    if (currentConv && currentConv.status === 'BOT') {
      console.log('[Webhook] Fallback: transferring to queue');
      await FlowEngine.transferToQueue(tenant, conversation, null);
    }
  } catch (fallbackErr) {
    // Logged error - conversation in undefined state
    console.error('[Webhook] Fallback failed too:', fallbackErr.message);
    // TODO: Alert administrators
  }
}
```

---

### Issue #8: Invalid Flow Configuration Not Properly Handled

**Severity**: 🟠 HIGH  
**Type**: Configuration Validation  
**Location**: `src/services/FlowEngine.js` lines 68-75

**Problem**:

```javascript
// Lines 68-75
const flows = tenant.flows || {};
const activeFlowId = flows.active || 'Padrão';
const flow = flows.uras?.[activeFlowId];

if (!flow || !flow.start) {
  console.error('[FlowEngine] Flow não configurado ou inválido');
  // Fallback genérico - sempre transfere para fila
  // Mas e se fila também estiver vazia?
}
```

**Risk**:

- Tenant criado sem nenhum flow configurado
- Conversa transferida para fila
- Fila vazia (nenhum agente disponível)
- Mensagem fica travada indefinidamente

**Solution**:

```javascript
// ✅ Validação abrangente
const flows = tenant.flows || {};
const activeFlowId = flows.active || 'Padrão';
const flow = flows.uras?.[activeFlowId];

if (!flow || !flow.start) {
  console.error('[FlowEngine] Flow inválido para tenant', {
    tenantId: tenant.id,
    activeFlowId,
    hasFlows: !!flows.uras,
    availableFlows: Object.keys(flows.uras || {})
  });

  // Enviar mensagem padrão
  await FlowEngine.sendMessage(
    conversation,
    'Olá! Estamos conectando você com um atendente. Um momento, por favor.',
    tenant
  );

  // Transferir para fila COM LOG EXPLÍCITO
  try {
    await FlowEngine.transferToQueue(tenant, conversation, null);
    console.log('[FlowEngine] Conversation transferred to queue due to missing flow');
  } catch (queueErr) {
    // CRITICAL: Não conseguiu nem colocar na fila
    console.error('[FlowEngine] CRITICAL: Cannot transfer to queue', {
      conversationId: conversation.id,
      error: queueErr.message
    });

    // Último recurso: marcar conversa em estado error
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'CLOSED',
        flowState: { error: 'SYSTEM_ERROR_QUEUE_FAILED' }
      }
    });

    // TODO: Alert administrator - system degraded
  }
  return;
}
```

---

### Issue #9: Contact Name Not Updated When Changed

**Severity**: 🟠 HIGH (Low priority but pattern violation)  
**Type**: Data Consistency  
**Location**: `src/controllers/WebhookController.js` lines 110-113

**Problem**:

```javascript
// Lines 110-113
} else if (contactName !== contact.name) {
  // Optional: Update name if changed
  // await prisma.contact.update(...)
  // ← COMMENTED OUT! Name never updated
}
```

**Risk**:

- Cliente muda nome no WhatsApp
- Sistema continua com nome antigo
- UI mostra informação desatualizada

**Solution**:

```javascript
// ✅ Uncomment e adicionar logging
} else if (contactName && contactName !== contact.name) {
  try {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { name: contactName }
    });
    console.log(`[Webhook] Contact name updated: ${contact.phone} → ${contactName}`);
  } catch (err) {
    // Non-critical - apenas log
    console.warn('[Webhook] Failed to update contact name:', err.message);
  }
}
```

---

## Medium-Risk Issues (🟡)

### Issue #10: Missing NULL Check for Contact in sendMessage

**Severity**: 🟡 MEDIUM  
**Type**: Error Handling  
**Location**: `src/services/FlowEngine.js` lines 743-750

**Problem**:

```javascript
// Lines 743-750
const contact = await prisma.contact.findUnique({
  where: { id: conversation.contactId }
});

if (!contact) {
  console.error('[FlowEngine] Contact not found');
  return; // Early exit - OK
}

// Mas se findUnique falhar (DB error), contact será undefined
// E código continua com contact = null
```

**Root Cause**: Ver Issue #1 - Contact busca sem tenantId

---

### Issue #11: No Validation of Tenant's WhatsApp Configuration

**Severity**: 🟡 MEDIUM  
**Type**: Configuration Validation  
**Location**: `src/services/FlowEngine.js` line 750 onwards (sendMessage)

**Problem**:

```javascript
// Código não valida se tenant.waAccessToken existe antes de chamar sendMessage
// sendMessage() assume que tenant.waAccessToken está configurado
```

---

## Implementation Patterns & Best Practices

### ✅ Good Patterns Found

1. **Transaction-like behavior in some places**:
   - `WebhookController` saves message and updates conversation
   - Should be wrapped in $transaction for atomicity

2. **Status state machine**:
   - BOT → QUEUED → ASSIGNED → RESOLVED/CLOSED
   - Prevents reactivation of closed conversations

3. **Socket.io tenant isolation**:
   - `io.to(`tenant:${tenant.id}`)` - Good pattern
   - Properly isolates real-time events per tenant

4. **FlowEngine pausable state**:
   - `waitingFor` mechanism prevents infinite loops
   - MAX_FLOW_STEPS limit prevents runaway execution

---

## Recommended Fixes Priority

| Priority | Issue                                    | Effort | Impact   |
| -------- | ---------------------------------------- | ------ | -------- |
| **P0**   | #1: Cross-tenant contact access          | High   | CRITICAL |
| **P0**   | #2: Null message.content                 | Low    | CRITICAL |
| **P0**   | #3: Uninitialized flowState.data         | Medium | CRITICAL |
| **P1**   | #4: Race condition message/conversation  | Medium | HIGH     |
| **P1**   | #5: Missing tenantId transfer validation | Low    | HIGH     |
| **P1**   | #6: Undefined skill assignment           | Low    | HIGH     |
| **P1**   | #7: Unhandled promise rejection          | Medium | HIGH     |
| **P1**   | #8: Invalid flow config                  | Medium | HIGH     |
| **P2**   | #9: Contact name sync                    | Low    | MEDIUM   |
| **P2**   | #10: Contact null check                  | Low    | MEDIUM   |
| **P2**   | #11: Tenant config validation            | Low    | MEDIUM   |

---

## Testing Recommendations

### Unit Tests Needed

- [ ] FlowEngine.process() with null message.content
- [ ] FlowEngine contact lookup validates tenantId
- [ ] TransferService validates cross-tenant attempts
- [ ] QueueService handles undefined skill gracefully
- [ ] Race condition: message + conversation update

### Integration Tests

- [ ] Full message flow: webhook → FlowEngine → queue → agent
- [ ] Multi-tenant concurrent messages
- [ ] State recovery after error
- [ ] Transfer between multiple agents

### Security Tests

- [ ] Tenant A cannot access Tenant B's contacts
- [ ] Tenant A cannot transfer Tenant B's conversations
- [ ] FlowEngine doesn't leak data between tenants

---

## Deployment Checklist

Before fixing any issues:

- [ ] Backup production database
- [ ] Test all fixes in staging with real webhook data
- [ ] Monitor for errors after deployment: P0 issues
- [ ] Rollback plan ready

---

## Summary Statistics

| Category           | Count    | Status                                                                                        |
| ------------------ | -------- | --------------------------------------------------------------------------------------------- |
| Total Issues Found | 11       | All analyzed                                                                                  |
| Critical (P0)      | 3        | Need immediate fix                                                                            |
| High (P1)          | 6        | Need fix before release                                                                       |
| Medium (P2)        | 2        | Can schedule after P0/P1                                                                      |
| **Files Affected** | **6**    | FlowEngine, WebhookController, QueueService, TransferService, ChatController, MediaController |
| **Severity**       | **HIGH** | **3 critical security/integrity issues identified**                                           |

---

**Version**: 1.0  
**Audit Type**: Code Review + Security Analysis  
**Timeframe**: Comprehensive (full chatbot flow analysis)  
**Next Step**: Implement P0 fixes first
