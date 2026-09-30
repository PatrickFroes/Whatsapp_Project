# 📡 Guia 3: Referência e Documentação Completa de APIs

Este guia descreve detalhadamente as rotas expostas pela API do **Broker**, seus payloads de entrada, esquemas de validação (Zod) e retornos HTTP padrão.

---

## 🔑 1. Autenticação e Gestão de Sessões (`/api/auth`)

Todas as chamadas para rotas protegidas exigem o token JWT enviado no cabeçalho `Authorization: Bearer <TOKEN>` ou via Cookie `auth_token`.

### `POST /api/auth/register`
- **Descrição**: Criação de novas contas. Registra o inquilino (Tenant) e o usuário administrador principal.
- **Request Body (JSON)**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePass123!",
    "name": "John Doe",
    "tenantName": "Acme Corp"
  }
  ```
- **Validações**:
  - `email`: RFC 5321 (deve ser único).
  - `password`: Mínimo 8 caracteres, contendo 1 letra maiúscula, 1 minúscula, 1 número e 1 caractere especial.
- **Response (201 Created)**:
  ```json
  {
    "user": { "id": "uuid-123", "email": "user@example.com", "role": "ADMIN", "tenantId": "tenant-abc" },
    "token": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi..."
  }
  ```

### `POST /api/auth/login`
- **Descrição**: Autenticação de usuários.
- **Request Body (JSON)**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePass123!"
  }
  ```
- **Response (200 OK)**: Retorna a estrutura do usuário logado, validade do token (em segundos) e seta o cookie de navegação seguro.

---

## 💬 2. Gestão de Chats e Mensagens (`/api/chats`)

### `GET /api/chats`
- **Descrição**: Lista todas as conversas do tenant do usuário.
- **Query Params**:
  - `status`: Filtro de estado (`BOT`, `QUEUED`, `ASSIGNED`, `RESOLVED`, `CLOSED`).
  - `page`: Número da página (padrão: 1).
  - `limit`: Quantidade de registros por página (padrão: 50, máximo: 100).
- **Lógica de Acesso (RBAC)**:
  - `AGENT`: Retorna apenas conversas sob custódia direta do agente.
  - `SUPERVISOR`/`ADMIN`: Retorna todas as conversas do tenant de forma irrestrita.

### `GET /api/chats/:phone/messages`
- **Descrição**: Lista o histórico completo de mensagens de um contato.
- **Response (200 OK)**:
  ```json
  [
    {
      "id": "msg-uuid",
      "content": "Olá, como posso ajudar?",
      "contentType": "text",
      "direction": "OUTBOUND",
      "status": "READ",
      "createdAt": "2026-07-23T09:00:00.000Z"
    }
  ]
  ```

### `POST /api/chats/:phone/send`
- **Descrição**: Envia mensagem de texto outbound.
- **Request Body (JSON)**:
  ```json
  {
    "content": "Sua solicitação foi processada com sucesso.",
    "contentType": "text"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": {
      "id": "msg-uuid",
      "content": "Sua solicitação...",
      "direction": "OUTBOUND",
      "waId": "wamid.HBgMNTU0MTk..."
    }
  }
  ```

### `POST /api/chats/:phone/resolve`
- **Descrição**: Finaliza o atendimento humano ativo, movendo o status para `RESOLVED` e liberando o agente.
- **Request Body (JSON)**:
  ```json
  {
    "closingNotes": "Cliente confirmou o recebimento da fatura.",
    "disposition": "Suporte Concluído"
  }
  ```

---

## 📝 3. Notas Internas e Comentários (`/api/notes`)

Atendentes podem salvar notas internas de controle privado vinculadas a uma conversa. O cliente do WhatsApp não recebe essas mensagens.

### `POST /api/notes/:conversationId`
- **Descrição**: Insere uma nova nota na conversa.
- **Request Body (JSON)**:
  ```json
  {
    "content": "Cliente irritado. Solicitar prioridade no setor financeiro."
  }
  ```
- **Response (201 Created)**: Retorna a nota criada no banco vinculada ao `userId` do autor.

---

## 🔄 4. Roteamento e Transferências (`/api/transfer`)

### `POST /api/conversations/:id/transfer`
- **Descrição**: Transfere o chat ativo para outro atendente ou departamento (Skill).
- **Request Body (JSON)**:
  ```json
  {
    "toUserId": "uuid-do-agente-destino", // Opcional se passar skill
    "skillName": "Financeiro",           // Opcional se passar toUserId
    "reason": "Dúvidas sobre faturas",
    "notes": "Cliente aguardando na linha"
  }
  ```
- **Validação de Segurança**: O sistema rejeita e aborta transferências imediatas caso o agente de destino pertença a um inquilino (`tenantId`) diferente do chat de origem.

---

## ⏰ 5. Horário Comercial (`/api/business-hours`)

### `GET /api/business-hours`
- **Descrição**: Retorna as janelas de horários e a mensagem de ausência configuradas para o tenant.

### `PUT /api/business-hours`
- **Descrição**: Atualiza as configurações de expediente do tenant.
- **Request Body (JSON)**:
  ```json
  {
    "enabled": true,
    "timezone": "America/Sao_Paulo",
    "hours": {
      "monday": { "open": "09:00", "close": "18:00" },
      "tuesday": { "open": "09:00", "close": "18:00" },
      "wednesday": { "open": "09:00", "close": "18:00" },
      "thursday": { "open": "09:00", "close": "18:00" },
      "friday": { "open": "09:00", "close": "18:00" },
      "saturday": null,
      "sunday": null
    },
    "autoReplyEnabled": true,
    "autoReplyMessage": "Olá! Nosso horário de atendimento é de segunda a sexta, das 09h às 18h."
  }
  ```
