# 🔧 Multi-Tenant Service Integration Guide

**Data**: 2026-03-04  
**Status**: Implementation Instructions for Services

---

## 📋 O Que Foi Feito

✅ **Webhook HMAC Validation** - Implementado  
✅ **ConfigurationController** - Salva credenciais  
❌ **Services** - Ainda não usam Configuration (próximo passo)

---

## 🎯 Serviços que Precisam Ser Corrigidos

### **1. FlowEngine.js** - Process WhatsApp Messages

**Problema Atual**:

```javascript
// ❌ ERRADO - Lê token de .env (global)
class FlowEngine {
  static async process(tenant, conversation, message) {
    const token = process.env.WHATSAPP_TOKEN;
    // Envia resposta para WhatsApp
  }
}
```

**Solução**:

```javascript
// ✅ CORRETO - Lê de Configuration do tenant
class FlowEngine {
  static async process(tenant, conversation, message) {
    // 1. Buscar configuration do tenant
    const config = await prisma.configuration.findUnique({
      where: { tenantId: tenant.id }
    });

    if (!config?.whatsappToken) {
      throw new Error(`WhatsApp token not configured for tenant: ${tenant.id}`);
    }

    // 2. Usar token do tenant para enviar resposta
    const response = await fetch(
      `https://graph.instagram.com/v18.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.from,
          text: { body: responseText }
        })
      }
    );
  }
}
```

---

### **2. MediaService.js** - Send/Upload Media

**Problema Atual**:

```javascript
// ❌ ERRADO - Usa token global
class MediaService {
  static async downloadMedia(tenantId, mediaId) {
    const token = process.env.WHATSAPP_TOKEN;
    const url = await fetch(`https://graph.instagram.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}
```

**Solução**:

```javascript
// ✅ CORRETO - Lê configuration do tenant
class MediaService {
  static async downloadMedia(tenantId, mediaId) {
    // 1. Buscar configuration
    const config = await prisma.configuration.findUnique({
      where: { tenantId }
    });

    if (!config?.whatsappToken) {
      throw new Error(`WhatsApp token not configured for tenant: ${tenantId}`);
    }

    // 2. Usar token do tenant
    const url = await fetch(`https://graph.instagram.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${config.whatsappToken}` }
    });
  }

  static async uploadMedia(tenantId, file) {
    const config = await prisma.configuration.findUnique({
      where: { tenantId }
    });

    if (!config?.phoneNumberId || !config?.whatsappToken) {
      throw new Error(`Configuration incomplete for tenant: ${tenantId}`);
    }

    // Upload usando phoneNumberId e whatsappToken do tenant
    const result = await fetch(`https://graph.instagram.com/v18.0/${config.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.whatsappToken}` },
      body: formData
    });
  }
}
```

---

### **3. QueueService.js** - Distribution & Routing

**Problema Atual**:

```javascript
// ❌ ERRADO - Pode não estar validando tenantId
class QueueService {
  static async assignConversation(conversationId, agentId) {
    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedToId: agentId }
    });
  }
}
```

**Solução**:

```javascript
// ✅ CORRETO - Sempre valida tenantId
class QueueService {
  static async assignConversation(tenantId, conversationId, agentId) {
    // 1. Validar que conversa pertence ao tenant
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (conversation.tenantId !== tenantId) {
      throw new Error('Conversation does not belong to this tenant');
    }

    // 2. Validar que agent pertence ao tenant
    const agent = await prisma.user.findUnique({
      where: { id: agentId }
    });

    if (agent.tenantId !== tenantId) {
      throw new Error('Agent does not belong to this tenant');
    }

    // 3. Atribuir
    const result = await prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedToId: agentId }
    });

    return result;
  }
}
```

---

## 📝 Plano de Implementação (Por Prioridade)

### **Priority 1 - CRÍTICO** (30 min)

**Arquivo**: `src/services/FlowEngine.js`

Mudanças necessárias:

1. Na função `process()`, após receber `tenant`:

   ```javascript
   const config = await prisma.configuration.findUnique({
     where: { tenantId: tenant.id }
   });
   if (!config?.whatsappToken) {
     console.error(`FlowEngine: WhatsApp token not configured for ${tenant.id}`);
     return; // Não processa se não tem token
   }
   ```

2. Ao enviar resposta para WhatsApp:
   ```javascript
   const response = await fetch(
     `https://graph.instagram.com/v18.0/${config.phoneNumberId}/messages`,
     {
       headers: { Authorization: `Bearer ${config.whatsappToken}` }
     }
   );
   ```

---

### **Priority 2 - CRÍTICO** (30 min)

**Arquivo**: `src/services/MediaService.js`

Mudanças necessárias:

1. Adicionar `tenantId` a todas as funções
2. Buscar Configuration baseado em tenantId
3. Usar token e phoneNumberId da Configuration

---

### **Priority 3 - IMPORTANTE** (1 hora)

**Arquivo**: `src/services/QueueService.js`

Mudanças necessárias:

1. Adicionar `tenantId` validação em todas as queries
2. Garantir que updates respeitam isolamento de tenant

---

### **Priority 4 - IMPORTANTE** (Audit)

**Verificar todos estes serviços**:

- [ ] src/services/BusinessHoursService.js
- [ ] src/services/QuickReplyService.js
- [ ] src/services/TransferService.js
- [ ] src/services/InternalNoteService.js
- [ ] src/services/AgentStatusService.js
- [ ] src/services/cache.service.js

Para cada um:

1. Todas as queries têm filtro `tenantId`?
2. Se usa credenciais, busca de Configuration?
3. Recebe `tenantId` como parâmetro?

---

## 🧪 Teste de Validação

Após implementar mudanças em cada serviço:

```javascript
// Teste: Criar 2 tenants com credenciais diferentes
const tenant1 = await prisma.tenant.create({ data: { name: 'Tenant A' } });
const tenant2 = await prisma.tenant.create({ data: { name: 'Tenant B' } });

// Configurar credentials
await prisma.configuration.create({
  data: { tenantId: tenant1.id, whatsappToken: 'token_A' }
});
await prisma.configuration.create({
  data: { tenantId: tenant2.id, whatsappToken: 'token_B' }
});

// Testar que cada tenant usa seu próprio token
const config1 = await prisma.configuration.findUnique({
  where: { tenantId: tenant1.id }
});
console.log('Tenant 1 token:', config1.whatsappToken); // token_A

// FlowEngine deveria enviar com token_A, não token_B
await FlowEngine.process(tenant1, conversation, message);
```

---

## 📊 Impact Analysis

| Serviço              | Impacto           | Esforço | Status   |
| -------------------- | ----------------- | ------- | -------- |
| FlowEngine           | 🔴 Alto (core)    | 30 min  | ❌ TODO  |
| MediaService         | 🔴 Alto (uploads) | 30 min  | ❌ TODO  |
| QueueService         | 🟡 Médio          | 20 min  | ❌ TODO  |
| BusinessHoursService | 🟢 Baixo          | 10 min  | ❌ TODO  |
| Others               | 🟢 Baixo          | 5 min   | ⏳ Audit |

**Tempo Total**: ~2 horas

---

## ✅ Checklist Pós-Implementação

- [ ] FlowEngine busca Configuration
- [ ] FlowEngine envia com token do tenant
- [ ] MediaService busca Configuration
- [ ] MediaService usa phoneNumberId do tenant
- [ ] QueueService valida tenantId
- [ ] Todos os services recebem tenantId
- [ ] Testes passam com 2+ tenants
- [ ] Logs mostram correlação tenant → token

---

## 🔐 Verificação de Segurança Final

```bash
# 1. Verificar que não há mais .env sendo usado
grep -r "WHATSAPP_TOKEN\|VERIFY_TOKEN" src/
# Deve retornar vazio (exceto comentários)

# 2. Verificar que Configuration é sempre usada
grep -r "process.env" src/services/
# Só deve ter JWT_SECRET, DATABASE_URL, etc (não credenciais)

# 3. Verificar que todos os controllers usam tenantId
grep -r "req.user.tenantId" src/controllers/
# Cada query deve filtrar
```

---

## 📝 Status Final

Após implementação destas mudanças:

✅ **Arquitetura Multi-Tenant Completa**:

- Backend: ✅ Isolamento via tenantId
- Webhook: ✅ HMAC validation por tenant
- Configuração: ✅ Credenciais por tenant
- Services: ⏳ **AINDA PRECISA**
- Frontend: ✅ Admin UI com settings
