/\*\*

- API_DOCUMENTATION.md - Documentação Completa dos Endpoints
-
- Cobre todos os endpoints da API com exemplos de requisição/resposta
  \*/

# WhatsApp Broker API Documentation v2.0

## Índice

1. [Authentication](#authentication)
2. [Messages](#messages)
3. [Conversations](#conversations)
4. [Users](#users)
5. [Admin](#admin)
6. [Error Handling](#error-handling)

---

## Authentication

### Register (Criar Conta)

**Endpoint**: `POST /auth/register`

**Autenticação**: Não requerida

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe",
  "tenantName": "Acme Corp"
}
```

**Validações**:

- Email: RFC 5321 compliant, deve ser único
- Password: Mínimo 8 caracteres, 1 maiúscula, 1 número, 1 caractere especial
- Name: Não vazio
- TenantName: Opcional, sistema cria automaticamente se não informado

**Response 200**:

```json
{
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "ADMIN",
    "tenantId": "tenant_123",
    "createdAt": "2024-02-11T10:30:00Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response 400** (Validação Falhou):

```json
{
  "error": "Validation error",
  "details": {
    "password": "Password must contain uppercase, number, and special character"
  }
}
```

**Response 409** (Email Já Existe):

```json
{
  "error": "Email already registered"
}
```

---

### Login

**Endpoint**: `POST /auth/login`

**Autenticação**: Não requerida

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response 200**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 604800,
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "role": "ADMIN"
  }
}
```

**Response 401** (Credenciais Inválidas):

```json
{
  "error": "Invalid email or password"
}
```

---

### Refresh Token

**Endpoint**: `POST /auth/refresh`

**Autenticação**: Requerida (Refresh Token no body)

**Request Body**:

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response 200**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 604800
}
```

---

## Messages

### Enviar Mensagem

**Endpoint**: `POST /chat/:conversationId/send`

**Autenticação**: JWT Bearer Token

**Request Body**:

```json
{
  "type": "text",
  "content": "Olá! Como posso ajudar?",
  "metadata": {
    "source": "agent",
    "agentId": "agent_123"
  }
}
```

**Tipos de Mensagem Suportados**:

- `text`: Mensagem de texto simples
- `image`: Imagem com legenda opcional
- `document`: Arquivo PDF, Word, etc
- `button`: Botões de ação
- `interactive_list`: Lista interativa

**Response 201** (Sucesso):

```json
{
  "id": "msg_123",
  "conversationId": "conv_456",
  "type": "text",
  "content": "Olá! Como posso ajudar?",
  "status": "sent",
  "createdAt": "2024-02-11T10:35:00Z",
  "correlationId": "1707647400-a1b2c3"
}
```

**Response 400** (Validação):

```json
{
  "error": "Validation error",
  "details": {
    "content": "Content is required"
  }
}
```

**Rate Limiting**:

- Limite: 100 mensagens por minuto por agente
- Status: X-RateLimit-Remaining header

---

### Obter Mensagens

**Endpoint**: `GET /chat/:conversationId/messages`

**Autenticação**: JWT Bearer Token

**Query Parameters**:

- `limit`: Número de mensagens (default: 50, max: 200)
- `offset`: Deslocamento para paginação (default: 0)
- `status`: Filtrar por status (sent, delivered, read, failed)

**Request**:

```
GET /chat/conv_456/messages?limit=50&offset=0
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response 200**:

```json
{
  "data": [
    {
      "id": "msg_123",
      "conversationId": "conv_456",
      "type": "text",
      "content": "Olá!",
      "status": "read",
      "createdAt": "2024-02-11T10:35:00Z",
      "sender": {
        "id": "agent_123",
        "name": "João Silva",
        "role": "AGENT"
      }
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  },
  "correlationId": "1707647400-a1b2c3"
}
```

---

## Conversations

### Listar Conversas

**Endpoint**: `GET /chat/conversations`

**Autenticação**: JWT Bearer Token

**Query Parameters**:

- `status`: ACTIVE, CLOSED, BOT
- `assignedAgentId`: Filtrar por agente atribuído
- `limit`: Paginação (default: 20)
- `offset`: Deslocamento (default: 0)

**Response 200**:

```json
{
  "data": [
    {
      "id": "conv_456",
      "participantPhone": "+5511987654321",
      "participantName": "Maria Silva",
      "status": "ACTIVE",
      "assignedAgentId": "agent_123",
      "assignedAgentName": "João Silva",
      "lastMessage": {
        "text": "Qual é o status?",
        "timestamp": "2024-02-11T10:40:00Z"
      },
      "createdAt": "2024-02-11T09:00:00Z",
      "updatedAt": "2024-02-11T10:40:00Z",
      "messageCount": 23,
      "isBot": false
    }
  ],
  "pagination": {
    "total": 450,
    "limit": 20,
    "offset": 0
  }
}
```

---

### Obter Conversa

**Endpoint**: `GET /chat/:conversationId`

**Autenticação**: JWT Bearer Token

**Response 200**:

```json
{
  "id": "conv_456",
  "participantPhone": "+5511987654321",
  "participantName": "Maria Silva",
  "participantAvatar": "https://...",
  "status": "ACTIVE",
  "assignedAgentId": "agent_123",
  "assignedAgentName": "João Silva",
  "history": {
    "createdAt": "2024-02-11T09:00:00Z",
    "firstMessage": "Olá, preciso de ajuda",
    "lastMessageAt": "2024-02-11T10:40:00Z"
  },
  "tags": ["vip", "priority"],
  "customFields": {
    "accountType": "premium",
    "purchaseHistory": "3"
  }
}
```

---

### Atribuir Conversa a Agente

**Endpoint**: `PUT /chat/:conversationId/assign`

**Autenticação**: JWT Bearer Token (SUPERVISOR ou ADMIN)

**Request Body**:

```json
{
  "agentId": "agent_123",
  "priority": "high"
}
```

**Response 200**:

```json
{
  "conversationId": "conv_456",
  "assignedAgentId": "agent_123",
  "assignedAt": "2024-02-11T10:50:00Z",
  "auditLog": {
    "action": "CONVERSATION_ASSIGNED",
    "performedBy": "supervisor_789",
    "timestamp": "2024-02-11T10:50:00Z",
    "correlationId": "1707647400-a1b2c3"
  }
}
```

---

## Users

### Listar Usuários

**Endpoint**: `GET /admin/users`

**Autenticação**: JWT Bearer Token (ADMIN ou SUPERVISOR)

**Query Parameters**:

- `role`: ADMIN, SUPERVISOR, AGENT
- `isActive`: true/false
- `limit`: Paginação (default: 20)

**Response 200**:

```json
{
  "data": [
    {
      "id": "user_123",
      "email": "joao@broker.com",
      "name": "João Silva",
      "role": "AGENT",
      "isActive": true,
      "status": "online",
      "lastSeenAt": "2024-02-11T10:45:00Z",
      "skills": ["billing", "technical"],
      "activeConversations": 5,
      "createdAt": "2024-01-15T08:00:00Z"
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 20,
    "offset": 0
  }
}
```

---

### Criar Usuário

**Endpoint**: `POST /admin/users`

**Autenticação**: JWT Bearer Token (ADMIN)

**Request Body**:

```json
{
  "email": "agent.novo@broker.com",
  "name": "Pedro Santos",
  "role": "AGENT",
  "skills": ["billing", "support"]
}
```

**Response 201**:

```json
{
  "id": "user_456",
  "email": "agent.novo@broker.com",
  "name": "Pedro Santos",
  "role": "AGENT",
  "status": "pending",
  "skills": ["billing", "support"],
  "invitationSent": true,
  "invitationExpires": "2024-02-18T10:55:00Z",
  "auditLog": {
    "action": "USER_CREATED",
    "performedBy": "admin_123",
    "correlationId": "1707647400-a1b2c3"
  }
}
```

---

## Admin

### Configurações de Tenant

**Endpoint**: `GET /admin/settings`

**Autenticação**: JWT Bearer Token (ADMIN)

**Response 200**:

```json
{
  "tenantId": "tenant_123",
  "name": "Acme Corp",
  "plan": "professional",
  "maxUsers": 50,
  "activeUsers": 23,
  "whatsappConfig": {
    "phoneNumber": "+5511987654321",
    "verified": true,
    "webhookUrl": "https://api.broker.com/webhook"
  },
  "businessHours": {
    "enabled": true,
    "timezone": "America/Sao_Paulo",
    "schedule": {
      "monday": { "start": "09:00", "end": "18:00" },
      "tuesday": { "start": "09:00", "end": "18:00" }
    }
  },
  "automationEnabled": true,
  "customFieldsEnabled": true,
  "billingInfo": {
    "plan": "professional",
    "monthly": 299.0,
    "nextBillingDate": "2024-03-11"
  }
}
```

---

### Audit Log

**Endpoint**: `GET /admin/audit-logs`

**Autenticação**: JWT Bearer Token (ADMIN)

**Query Parameters**:

- `action`: Tipo de ação (LOGIN, USER_DELETE, etc)
- `userId`: Filtrar por usuário
- `startDate`: Data inicial (ISO 8601)
- `endDate`: Data final
- `limit`: Items por página

**Response 200**:

```json
{
  "data": [
    {
      "id": "audit_123",
      "action": "USER_DELETE",
      "performedBy": "admin_123",
      "performedByName": "Admin User",
      "timestamp": "2024-02-11T10:45:00Z",
      "targetUser": "user_456",
      "targetUserName": "Pedro Santos",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "correlationId": "1707647400-a1b2c3",
      "status": "success",
      "details": {
        "reason": "Terminated"
      }
    }
  ],
  "pagination": {
    "total": 1250,
    "limit": 20
  }
}
```

---

## Error Handling

### Estrutura de Erro Padrão

```json
{
  "error": "Descriptive error message",
  "details": {
    "field": "error description"
  },
  "correlationId": "1707647400-a1b2c3",
  "timestamp": "2024-02-11T10:55:00Z"
}
```

### Status Codes

| Código | Significado         | Exemplo                    |
| ------ | ------------------- | -------------------------- |
| 200    | OK                  | Request bem-sucedido       |
| 201    | Created             | Recurso criado com sucesso |
| 400    | Bad Request         | Validação falhou           |
| 401    | Unauthorized        | Token ausente/inválido     |
| 403    | Forbidden           | Sem permissão              |
| 404    | Not Found           | Recurso não encontrado     |
| 409    | Conflict            | Email já existe            |
| 429    | Too Many Requests   | Rate limit atingido        |
| 500    | Server Error        | Erro interno do servidor   |
| 503    | Service Unavailable | Database offline           |

### Rate Limiting Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1707647460
```

---

## Headers Importantes

### Request

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Correlation-ID: 1707647400-a1b2c3
Content-Type: application/json
```

### Response

```
X-Correlation-ID: 1707647400-a1b2c3
X-RateLimit-Remaining: 95
Content-Type: application/json
```

---

## Exemplos de Integração

### cURL

```bash
# Login
curl -X POST https://api.broker.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"SecurePass123!"}'

# Enviar mensagem
curl -X POST https://api.broker.com/chat/conv_456/send \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"text","content":"Olá!"}'
```

### JavaScript/Node.js

```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'https://api.broker.com',
  headers: {
    Authorization: `Bearer ${token}`
  }
});

// Login
const { data } = await api.post('/auth/login', {
  email: 'user@example.com',
  password: 'SecurePass123!'
});

// Enviar mensagem
await api.post(`/chat/${conversationId}/send`, {
  type: 'text',
  content: 'Olá!'
});
```

### Python

```python
import requests

api = requests.Session()
api.headers.update({
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
})

# Login
response = api.post('https://api.broker.com/auth/login', json={
    'email': 'user@example.com',
    'password': 'SecurePass123!'
})

# Enviar mensagem
response = api.post(f'https://api.broker.com/chat/{conversation_id}/send', json={
    'type': 'text',
    'content': 'Olá!'
})
```

---

**Última Atualização**: 2024-02-11
**Versão**: 2.0.0
**Contato**: api-support@broker.com
