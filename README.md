# WhatsApp Broker - Multi-Tenant SaaS Platform

Sistema profissional de Contact Center com suporte a WhatsApp Business Cloud API, multi-tenancy e funcionalidades avançadas.

## 🚀 Status do Projeto

**Versão**: 2.0  
**Status**: ✅ Produção Ready  
**Última Atualização**: 11/02/2026

## ⭐ Funcionalidades Principais

### Core (Base)

### 📎 Fase 2 - Rich Features (NOVO! ✨)

# WhatsApp Broker SaaS

## 📦 Stack Tecnológica

Este projeto é um sistema de broker para WhatsApp, multi-tenant, com painel administrativo, controle de usuários, histórico de conversas e integração via API.

## Funcionalidades

- Gestão de múltiplos tenants
- Painel para admin, supervisor, super admin e agentes
- Controle de usuários, permissões e sessões
- Histórico de conversas e notas internas
- Integração com WhatsApp Business API
- Sistema de billing por mensagens e usuários
- Containerização via Docker
- **Runtime**: Node.js 18+

## Instalação

1. Clone o repositório
2. Configure o arquivo `.env` com suas credenciais
3. Execute `npm install` para instalar dependências
4. Use `docker-compose up` para iniciar os serviços

- **Framework**: Express.js 4.18

## Estrutura

- `frontend/`: Interface web para diferentes papéis
- `src/`: Backend Node.js com Express e Prisma
- `prisma/`: Migrações e schema do banco
- `scripts/`: Scripts utilitários
- **Database**: PostgreSQL + Prisma ORM

## Uso

Acesse o painel via navegador em `http://localhost:3000` após iniciar o servidor.

- **Cache**: Redis

## Contribuição

Pull requests são bem-vindos. Para grandes mudanças, abra uma issue primeiro.

- **Real-time**: Socket.io

## Licença

MIT

- **WhatsApp**: Meta Cloud API (Oficial)
- **Auth**: JWT + bcrypt
- **Upload**: Multer + Form-Data

---

## 🏗️ Arquitetura

```
whatsapp-broker/
├── src/
│   ├── services/          # Lógica de negócio
│   ├── controllers/       # Handlers de requisições
│   ├── routes/           # Rotas REST
│   ├── middleware/       # Auth, validation
│   └── utils/            # Helpers
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── migrations/       # DB migrations
├── frontend/             # UI (HTML/JS/CSS)
└── uploads/              # Temporary files
```

---

## 🚀 Quick Start

### 1. Pré-requisitos

| Ferramenta              | Versão Mínima           | Verificar   |
| ----------------------- | ----------------------- | ----------- |
| Node.js                 | 18+                     | `node -v`   |
| Docker & Docker Compose | Qualquer versão recente | `docker -v` |
| Git                     | Qualquer                | `git -v`    |

### 2. Clonar e Instalar

```bash
git clone <repo-url>
cd whatsapp-broker
npm install
```

### 3. Configurar Ambiente

```bash
cp .env.example .env
```

> ⚠️ **IMPORTANTE**: Edite o `.env` com suas credenciais. NUNCA commite o `.env`!

Variáveis obrigatórias no `.env`:

```env
# Gere um segredo forte: openssl rand -base64 32
JWT_SECRET="seu-secret-super-seguro-aqui"

# Meta WhatsApp Business API
WHATSAPP_TOKEN="seu-token-da-meta"
PHONE_NUMBER_ID="seu-phone-number-id"
WEBHOOK_VERIFY_TOKEN="token-de-verificacao-do-webhook"

# Banco de Dados (o Docker Compose sobe automaticamente)
DATABASE_URL="postgresql://postgres_admin:SuaSenha@localhost:5432/whatsapp_broker?schema=public"
REDIS_URL="redis://localhost:6379"
```

### 4. Subir Infraestrutura (PostgreSQL + Redis + pgAdmin)

```bash
npm run docker:up
```

### 5. Aplicar Migrações e Gerar Prisma Client

```bash
npm run setup      # instala deps + gera client + aplica migrations
```

Ou individualmente:

```bash
npx prisma generate        # Gera Prisma Client
npx prisma migrate deploy  # Aplica migrations
```

### 6. Criar Super Admin

```bash
npm run db:seed
```

### 7. Iniciar Servidor

```bash
npm start          # Produção
npm run dev        # Desenvolvimento (auto-reload)
```

Servidor rodando em `http://localhost:3001` 🎉

### 📋 Scripts Disponíveis

| Comando               | Descrição                                           |
| --------------------- | --------------------------------------------------- |
| `npm start`           | Inicia em modo produção                             |
| `npm run dev`         | Inicia com auto-reload (desenvolvimento)            |
| `npm run setup`       | Instala deps + gera client + aplica migrations      |
| `npm run db:studio`   | Abre Prisma Studio (GUI do banco) em localhost:5555 |
| `npm run db:migrate`  | Aplica migrations pendentes                         |
| `npm run db:reset`    | Reseta banco (CUIDADO: apaga dados!)                |
| `npm run db:seed`     | Cria Super Admin                                    |
| `npm run docker:up`   | Sobe containers Docker                              |
| `npm run docker:down` | Para containers Docker                              |

---

## 📚 Documentação Completa

### FlowEngine (Bot/URA)

- **[docs/FLOW_ENGINE_GUIDE.md](docs/FLOW_ENGINE_GUIDE.md)** - Guia completo de configuração e uso
- **[docs/flow_example_simple.json](docs/flow_example_simple.json)** - Flow básico para testes
- **[docs/flow_example_demo_complete.json](docs/flow_example_demo_complete.json)** - Flow completo demonstrativo

---

## 🌐 API Endpoints

### 📎 Media (Fase 2)

```http
POST /api/media/upload          # Upload e envio de mídia
POST /api/media/send-url         # Envio por URL
POST /api/media/location         # Envio de localização
```

### ⚡ Quick Replies (Fase 2)

```http
GET    /api/quick-replies                 # Listar todas
POST   /api/quick-replies                 # Criar
GET    /api/quick-replies/:shortcut       # Buscar e processar
PUT    /api/quick-replies/:id             # Atualizar
DELETE /api/quick-replies/:id             # Deletar
```

### 📝 Internal Notes (Fase 2)

```http
GET    /api/conversations/:id/notes       # Listar notas
POST   /api/conversations/:id/notes       # Criar nota
DELETE /api/notes/:noteId                 # Deletar nota
```

### 🔄 Transfers (Fase 2)

```http
POST /api/conversations/:id/transfer           # Transferir
GET  /api/transfer/available-agents            # Listar agentes
GET  /api/transfer/users/:userId/stats         # Estatísticas
```

### ⏰ Business Hours (Fase 2)

```http
GET /api/business-hours                  # Obter config
PUT /api/business-hours                  # Atualizar config
GET /api/business-hours/status           # Status atual
```

### 💬 Chat (Core)

```http
GET  /api/chats                          # Listar conversas
GET  /api/chats/:phone/messages          # Mensagens
POST /api/chats/:phone/send              # Enviar mensagem
POST /api/chats/:phone/resolve           # Resolver conversa
```

### 🔐 Auth (Core)

```http
POST /api/auth/register                  # Registrar
POST /api/auth/login                     # Login
GET  /api/auth/me                        # Usuário atual
```

### 👤 Admin (Core)

```http
GET    /api/admin/users                  # Listar usuários
POST   /api/admin/users                  # Criar usuário
PUT    /api/admin/users/:id              # Atualizar usuário
DELETE /api/admin/users/:id              # Deletar usuário
GET    /api/admin/stats                  # Estatísticas
PUT    /api/admin/flows                  # Atualizar URA
```

---

## 🧪 Exemplos de Uso

### Upload de Imagem

```bash
curl -X POST http://localhost:3000/api/media/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@image.jpg" \
  -F "phone=5511999999999" \
  -F "caption=Olá, segue a imagem!"
```

### Criar Quick Reply

```bash
curl -X POST http://localhost:3000/api/quick-replies \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Saudação",
    "shortcut": "/oi",
    "content": "Olá {{name}}, como posso ajudar?",
    "category": "Greeting"
  }'
```

### Usar Quick Reply com Variáveis

```bash
curl -X GET "http://localhost:3000/api/quick-replies//oi?name=João" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Retorna: "Olá João, como posso ajudar?"
```

### Transferir Conversa

```bash
curl -X POST http://localhost:3000/api/conversations/123/transfer \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "toUserId": "agent-456",
    "reason": "Cliente solicitou supervisor"
  }'
```

---

## 🐳 Docker

### Build da Imagem

```bash
docker build -t whatsapp-broker .
```

### Rodar Container

```bash
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  --name whatsapp-broker \
  whatsapp-broker
```

### Docker Compose (Recomendado)

```bash
docker-compose up -d
```

---

## 🔒 Segurança

- ✅ **Helmet** - HTTP Security Headers
- ✅ **JWT Authentication** obrigatório com expiração
- ✅ **Bcrypt** para hash de senhas
- ✅ **CORS** restrito com whitelist + suporte ngrok
- ✅ **Tenant Isolation** garantido em todas as queries
- ✅ **Rate Limiting** inteligente (userId para autenticados, IP para anônimos)
- ✅ **Input Validation** centralizada (email, phone, UUID, strings)
- ✅ **XSS Protection** com sanitização de HTML
- ✅ **Error Handling** centralizado (sem leak de info em produção)
- ✅ **Logging** condicional com mascaramento de dados sensíveis
- ✅ **Compression** gzip habilitado
- ✅ **Permissões** por role (SUPER_ADMIN/ADMIN/SUPERVISOR/AGENT)

### ⚠️ Checklist de Segurança para Produção

1. Defina `NODE_ENV=production` no `.env`
2. Gere um JWT_SECRET forte: `openssl rand -base64 32`
3. Use senhas fortes para PostgreSQL e Redis
4. Configure HTTPS (nginx reverse proxy ou cloud provider)
5. **NUNCA** commite `.env` ou credenciais no repositório

---

## 📊 Database Schema

### Principais Models

- **Tenant** - Clientes multi-tenant
- **User** - Agentes/Admins com roles
- **Contact** - Contatos do WhatsApp
- **Conversation** - Conversas ativas
- **Message** - Mensagens (IN/OUT)
- **QuickReply** - Respostas rápidas
- **InternalNote** - Notas internas
- **ConversationTransfer** - Histórico de transferências
- **Skill** - Habilidades dos agentes
- **Template** - Templates aprovados
- **Campaign** - Campanhas de envio

---

## 🚦 Roadmap

### ✅ Fase 1 - Core (Completo)

- Multi-tenancy
- Autenticação
- Chat básico
- URA/Flow Engine
- Queue system

### ✅ Fase 2 - Rich Features (Completo)

- Rich media support
- Quick replies
- Internal notes
- Agent transfers
- Business hours

### 🔄 Fase 3 - IA/NLP (Próximo)

- [ ] Integração ChatGPT/Dialogflow
- [ ] Análise de sentimento
- [ ] Roteamento inteligente
- [ ] Sugestões automáticas

### 📅 Fase 4 - Omnichannel

- [ ] Facebook Messenger
- [ ] Instagram Direct
- [ ] Telegram
- [ ] SMS
- [ ] Email
- [ ] WebChat

### 💼 Fase 5 - Enterprise

- [ ] Integrações CRM (Salesforce, HubSpot)
- [ ] SLA Management
- [ ] White label
- [ ] Analytics avançado
- [ ] Voice/Video calls

---

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Add nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

---

## 📝 Licença

Este projeto é privado e proprietário.

---

## 👨‍💻 Desenvolvido por

**WhatsApp Broker Team**  
Data: 2026  
Versão: 2.0

---

## 📞 Suporte

Para dúvidas ou suporte:

- 📧 Email: support@example.com
- 📱 WhatsApp: +55 11 99999-9999
- 📚 Docs: [docs/FLOW_ENGINE_GUIDE.md](docs/FLOW_ENGINE_GUIDE.md)

---

**Status**: ✅ Produção Ready | **Fase**: 2/5 Completa | **Backend**: 100%
