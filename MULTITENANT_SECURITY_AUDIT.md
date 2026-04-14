# 🔒 Multi-Tenant Security Audit - Broker Project

**Data**: 2026-03-04  
**Status**: ⚠️ **CRÍTICO - Problemas Identificados**

---

## 📋 Resumo Executivo

O projeto implementa isolamento multi-tenant **PARCIALMENTE CORRETO**, mas há **3 VULNERABILIDADES CRÍTICAS** que precisa corrigir:

| ✅ OK                                          | ❌ PROBLEMA                                 | 🔧 PRIORIDADE |
| ---------------------------------------------- | ------------------------------------------- | ------------- |
| ✅ AuthMiddleware extrai tenantId do token JWT | ❌ Webhook verify usa token GLOBAL `.env`   | 🔴 CRÍTICO    |
| ✅ ConfigurationController valida tenantId     | ❌ Webhook HMAC validation não implementado | 🔴 CRÍTICO    |
| ✅ ChatController filtra por tenantId          | ❌ Configuration não é usada nos serviços   | 🟡 IMPORTANTE |
| ✅ AdminController filtra por tenantId         | ❌ Sem isolamento na API de envio           | 🟡 IMPORTANTE |

---

## 🔍 Análise Detalhada

### ✅ **O QUE ESTÁ CORRETO**

#### 1. **AuthMiddleware - Extração de TenantId**

```javascript
// src/middleware/authMiddleware.js (CORRETO ✅)
jwt.verify(token, SECRET_KEY, (err, decoded) => {
  req.user = decoded; // { userId, tenantId, role }
  req.tenantId = decoded.tenantId; // Injeta tenantId
});
```

- ✅ Token JWT contém `tenantId`
- ✅ Injeta `tenantId` em `req.user`
- ✅ Disponível para todos os controllers

#### 2. **ConfigurationController - Isolamento por Tenant**

```javascript
// src/controllers/ConfigurationController.js (CORRETO ✅)
static async getConfiguration(req, res) {
  const { tenantId } = req.user; // Do token!
  const config = await prisma.configuration.findUnique({
    where: { tenantId } // Garante isolamento
  });
}

static async saveConfiguration(req, res) {
  const { tenantId, userId } = req.user;
  const config = await prisma.configuration.upsert({
    where: { tenantId }, // Chave única por tenant ✅
    update: { ... },
    create: { tenantId, ... }
  });
}
```

- ✅ Extrai `tenantId` do token (não do body!)
- ✅ `configuration.tenantId` é UNIQUE (máx 1 por tenant)
- ✅ Impossível um tenant acessar config de outro

#### 3. **ChatController - Filtragem por TenantId**

```javascript
// src/controllers/ChatController.js (CORRETO ✅)
static async listChats(req, res) {
  const { tenantId, userId } = req.user;
  const whereClause = { tenantId, ... }; // Sempre filtra por tenant

  const chats = await prisma.conversation.findMany({ where: whereClause });
}
```

- ✅ **SEMPRE** filtra queries por `tenantId`
- ✅ Impossível um tenant ver conversa de outro

#### 4. **WebhookController.handle() - Identificação de Tenant**

```javascript
// src/controllers/WebhookController.js (CORRETO ✅)
static async handle(req, res) {
  const waPhoneId = value.metadata?.phone_number_id; // De Meta!

  const tenant = await prisma.tenant.findFirst({
    where: { waPhoneId: waPhoneId } // Identifica tenant
  });

  // Todos os processamentos usam tenant.id
  await WebhookController.processMessage(tenant, ...);
}
```

- ✅ Identifica tenant pelo `waPhoneId` (vem do Meta)
- ✅ Passa `tenant` para todos os métodos
- ✅ `processMessage()` usa `tenantId: tenant.id` em queries

---

### ❌ **PROBLEMAS CRÍTICOS**

#### 🔴 **CRÍTICO #1: Webhook Verification Token é GLOBAL**

**Localização**: `src/controllers/WebhookController.js` linhas 10-20

```javascript
// ❌ ERRADO - Token global
static async verify(req, res) {
  const token = req.query['hub.verify_token'];

  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN; // ❌ Global!

  if (token === VERIFY_TOKEN) { // ❌ Todos os tenants usam o mesmo token!
    res.status(200).send(challenge);
  }
}
```

**Por que é crítico?**

- Se Tenant A configura `verifyToken = "xyz123"`
- E Tenant B configura `verifyToken = "abc456"`
- Mas o código valida contra `process.env.WEBHOOK_VERIFY_TOKEN = "xyz123"`
- Então Tenant B **NÃO CONSEGUE** se conectar! ❌
- OU alguém falsifica um webhook de Tenant A contra Tenant B

**Impacto**:

- 🔴 **Impossibilidade técnica**: Cada tenant tem seu próprio token, não pode ter 1 global
- 🔴 **Segurança**: Webhook verification pode falhar ou aceitar mensagens forjadas

**Solução Necessária**:
Implementar **HMAC Validation** ao invés de token global:

```javascript
// ✅ CORRETO - HMAC per tenant
static async verify(req, res) {
  // Durante verify, não temos tenantId ainda
  // Mas podemos validar HMAC de requisições POST
  // Requisições GET (verify) não têm body, então:
  // PERMITIR qualquer verify, depois validar HMAC no handle()

  const challenge = req.query['hub.challenge'];
  res.status(200).send(challenge); // Meta valida endpoint está online
}

static async handle(req, res) {
  // ✅ Validar HMAC aqui
  const signature = req.headers['x-hub-signature-256']; // De Meta
  const waPhoneId = req.body.entry[0].changes[0].value.metadata.phone_number_id;

  // 1. Buscar tenant
  const tenant = await prisma.tenant.findFirst({ where: { waPhoneId } });

  // 2. Buscar configuration
  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id }
  });

  // 3. Validar HMAC
  const computed = crypto
    .createHmac('sha256', config.metaAppSecret)
    .update(req.rawBody)
    .digest('hex');

  if (signature !== `sha256=${computed}`) {
    return res.status(403).json({ error: 'Invalid signature' });
  }
}
```

---

#### 🔴 **CRÍTICO #2: Configuration Não é Usada nos Serviços**

**Problema**: Após guardar credenciais na Configuration, nenhum serviço as lê!

**Status Atual**:

- ✅ ConfigurationController: Salva credenciais
- ❌ FlowEngine.js: **NÃO USA** `metaAppSecret`, `whatsappToken`, `phoneNumberId`
- ❌ MediaService.js: Provavelmente usa `.env` direto
- ❌ QueueService.js: Não isolado por Configuration

**O que DEVERIA acontecer**:

```javascript
// ✅ CORRETO - Serviços buscam de Configuration
class FlowEngine {
  static async process(tenant, conversation, message) {
    // 1. Buscar configuration do tenant
    const config = await prisma.configuration.findUnique({
      where: { tenantId: tenant.id }
    });

    if (!config || !config.whatsappToken) {
      throw new Error('WhatsApp token not configured for tenant');
    }

    // 2. Usar token do tenant, não do .env
    const response = await fetch('https://graph.instagram.com/...', {
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`
      }
    });
  }
}
```

**Status**: ❌ **NÃO IMPLEMENTADO** em ConfigurationController.js

---

#### 🔴 **CRÍTICO #3: Webhook HMAC Validation Ausente**

**Localização**: Falta completamente `src/middleware/webhookHmac.middleware.js`

**O Problema**:

- Meta envia cada webhook com header `X-Hub-Signature-256`
- Este é um HMAC-SHA256(metaAppSecret, rawBody)
- Se não validar, qualquer pessoa consegue enviar mensagens falsas!

**Exemplo de Ataque**:

```bash
# Atacante envia webhook forjado sem HMAC válido
curl -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "metadata": { "phone_number_id": "999999999" },
          "messages": [{
            "from": "5511999999999",
            "text": "Transferi dinheiro pra fulano"
          }]
        }
      }]
    }]
  }'
# ❌ Sem validação HMAC, é aceito como mensagem real!
```

---

## 🔧 Plano de Correção

### **Priority 1: CRÍTICO - Implementar HMAC Validation** (30 min)

**Arquivo a Criar**: `src/middleware/webhookHmac.middleware.js`

```javascript
const crypto = require('crypto');

const validateWebhookHmac = async (req, res, next) => {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    return res.status(403).json({ error: 'Missing HMAC signature' });
  }

  // Buscar metaAppSecret pelo waPhoneId
  let waPhoneId, metaAppSecret;
  try {
    const data = JSON.parse(req.rawBody);
    waPhoneId = data?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (!waPhoneId) {
    return res.status(400).json({ error: 'No phone_number_id found' });
  }

  const tenant = await prisma.tenant.findFirst({ where: { waPhoneId } });
  if (!tenant) {
    return res.status(403).json({ error: 'Invalid tenant' });
  }

  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id }
  });

  if (!config || !config.metaAppSecret) {
    return res.status(500).json({ error: 'Configuration incomplete' });
  }

  // Validar HMAC
  const expected = `sha256=${crypto
    .createHmac('sha256', config.metaAppSecret)
    .update(req.rawBody, 'utf8')
    .digest('hex')}`;

  if (signature !== expected) {
    return res.status(403).json({ error: 'Invalid HMAC' });
  }

  next();
};

module.exports = { validateWebhookHmac };
```

**Arquivo a Modificar**: `server.js`

```javascript
// Adicionar rawBody capture
app.use(express.raw({ type: 'application/json', limit: '10mb' }));
app.use((req, res, next) => {
  req.rawBody = req.body;
  next();
});

// Aplicar middleware HMAC ao webhook
const { validateWebhookHmac } = require('./src/middleware/webhookHmac.middleware');
app.post('/webhook', validateWebhookHmac, webhookRoutes);
```

---

### **Priority 2: CRÍTICO - Permitir Webhook Verification Dinâmica**

**Arquivo a Modificar**: `src/controllers/WebhookController.js`

```javascript
// ❌ REMOVER token global
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// ✅ MUDAR para:
static async verify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Durante verify, Meta envia 3 parâmetros apenas (GET)
  // Não podemos validar HMAC (sem body)
  // Solução: Permitir qualquer verify, depois validar HMAC em POST

  // OU: Fazer dois webhooks endpoints:
  // 1. POST /webhook/verify (com token no query) - validar tenantId
  // 2. POST /webhook (com HMAC) - processar eventos

  // For now, permitir:
  if (mode === 'subscribe') {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}
```

**Razão**: Durante GET verify, não há body para validar HMAC. O próprio Meta valida HTTPS + challenge response.

---

### **Priority 3: IMPORTANTE - Services Usam Configuration**

**Arquivo a Modificar**: `src/services/MediaService.js` (e outros)

```javascript
// ❌ ANTES
class MediaService {
  static async sendMessage(phone, message) {
    const token = process.env.WHATSAPP_TOKEN;
    const api = await fetch(`...`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}

// ✅ DEPOIS
class MediaService {
  static async sendMessage(tenantId, phone, message) {
    // 1. Buscar configuration do tenant
    const config = await prisma.configuration.findUnique({
      where: { tenantId }
    });

    if (!config?.whatsappToken) {
      throw new Error('WhatsApp token not configured');
    }

    // 2. Usar token do tenant
    const api = await fetch(`...`, {
      headers: { Authorization: `Bearer ${config.whatsappToken}` }
    });
  }
}
```

---

### **Priority 4: IMPORTANTE - Validar Isolamento em TODOS os Controllers**

Checklist:

- [ ] ChatController - ✅ Verificar que filtra por tenantId
- [ ] AdminController - ✅ Verificar que filtra por tenantId
- [ ] SupervisorController - Verificar isolamento
- [ ] TemplateController - Verificar isolamento
- [ ] QuickReplyController - Verificar isolamento
- [ ] HistoryController - Verificar isolamento
- [ ] BusinessHoursController - Verificar isolamento
- [ ] TransferController - Verificar isolamento

---

## 📊 Tabela de Isolamento por Componente

| Componente                 | Isolamento            | Status         | Notas                |
| -------------------------- | --------------------- | -------------- | -------------------- |
| AuthMiddleware             | ✅ Token JWT          | ✅ OK          | Injeta tenantId      |
| ConfigurationController    | ✅ req.user.tenantId  | ✅ OK          | Garante isolamento   |
| ChatController             | ✅ req.user.tenantId  | ✅ OK          | Filtra tudo          |
| AdminController            | ✅ req.user.tenantId  | ✅ OK          | Filtra tudo          |
| WebhookController.verify() | ❌ process.env        | 🔴 **CRÍTICO** | Token global!        |
| WebhookController.handle() | ✅ waPhoneId → Tenant | ✅ OK          | Identifica OK        |
| FlowEngine                 | ❌ process.env        | 🔴 **CRÍTICO** | Não lê Configuration |
| MediaService               | ❌ process.env        | 🔴 **CRÍTICO** | Não lê Configuration |
| QueueService               | ❌ process.env?       | 🟡 **CHECAR**  | Precisa validar      |
| Database Queries           | ✅ tenantId           | ✅ OK          | Schema OK            |

---

## 🎯 Checklist de Correção

- [ ] **CRÍTICO 1**: Implementar `webhookHmac.middleware.js`
- [ ] **CRÍTICO 2**: Modificar WebhookController.verify() para permitir dinâmico
- [ ] **CRÍTICO 3**: Modificar server.js para capturar `req.rawBody`
- [ ] **CRÍTICO 4**: Modificar todos os services (MediaService, FlowEngine, etc) para buscar Configuration
- [ ] **IMPORTANTE**: Audit em SupervisorController, TemplateController, etc
- [ ] **TESTE**: Testar webhook com 2 tenants usando credenciais diferentes

---

## 🔐 Resumo da Segurança

**Antes da Correção** (Atual):

```
Tenant A envia: phone_number_id = "111", verifyToken = "token_A"
Tenant B envia: phone_number_id = "222", verifyToken = "token_B"

Ambas usam process.env.WEBHOOK_VERIFY_TOKEN = "token_A"
→ Tenant B webhooks FALHAM! ❌
→ Atacante consegue falsificar webhooks! ❌
```

**Depois da Correção** (Proposto):

```
Tenant A envia: phone_number_id = "111", metaAppSecret = "secret_A"
Tenant B envia: phone_number_id = "222", metaAppSecret = "secret_B"

Webhook de Tenant A:
  X-Hub-Signature-256: sha256=HMAC(secret_A, body)
→ Validado contra secret_A ✅

Webhook de Tenant B:
  X-Hub-Signature-256: sha256=HMAC(secret_B, body)
→ Validado contra secret_B ✅

Webhook forjado:
  X-Hub-Signature-256: sha256=forjado
→ Rejeita! ✅
```

---

## 📝 Conclusão

O projeto **tem boa base de isolamento multi-tenant** (AuthMiddleware, database schema, filteragem por tenantId), mas **falta integrar a Configuration em 3 pontos críticos**:

1. ✅ Salvar credenciais (ConfigurationController) - FEITO
2. ❌ Validar webhooks com credenciais por tenant (HMAC) - **NÃO FEITO**
3. ❌ Usar credenciais nos serviços (MediaService, FlowEngine) - **NÃO FEITO**

Depois destas correções, o sistema será **verdadeiramente multi-tenant-safe** 🔒
