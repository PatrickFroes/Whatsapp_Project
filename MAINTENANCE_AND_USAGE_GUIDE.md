/\*\*

- MAINTENANCE_AND_USAGE_GUIDE.md - Guia de Manutenção e Uso
-
- Como usar, manter e expandir o projeto após implementação das 8 fases
  \*/

# WhatsApp Broker v2.0.0 - Maintenance & Usage Guide

## 1. Estrutura do Projeto

```
Broker/
├── src/
│   ├── config/          # Configurações (constantes, swagger)
│   ├── controllers/     # Lógica de negócio (13 controllers)
│   ├── middleware/      # Middleware Express (auth, validation, rate limit, etc)
│   ├── routes/          # Rotas da API (14 route files)
│   ├── schemas/         # Validação Zod (auth, tenant, message, user)
│   ├── services/        # Serviços (BD, cache, audit, flow engine, etc)
│   └── utils/           # Utilidades (logger, validators, SafeEvaluator)
├── __tests__/           # Testes (jest + supertest)
├── prisma/              # ORM configuration e migrations
├── frontend/            # UI files (HTML/CSS/JS)
├── docs/                # Documentação técnica
├── scripts/             # Utilitários CLI
├── server.js            # Entry point
└── package.json         # Dependências
```

---

## 2. Development Workflow

### 2.1 Setup Inicial

```bash
# Clonar repositório
git clone https://github.com/your-org/broker.git
cd broker

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas configurações

# Setup database
npx prisma generate
npx prisma db push
npx prisma db seed  # Opcional - popular dados iniciais

# Iniciar servidor
npm start
```

### 2.2 Comandos Principais

```bash
# Development
npm run dev              # Com nodemon (recarrega on changes)
npm start              # Iniciar servidor

# Code Quality
npm run quality        # ESLint + Prettier + Jest (tudo junto)
npm run lint          # ESLint apenas
npm run format        # Prettier - formatar arquivos
npm run format:check  # Prettier - verificar formatação
npm run test          # Jest - rodar testes

# Database
npx prisma studio    # Interface visual do banco
npx prisma migrate dev --name "nome_migration"  # Criar migration
npx prisma db push   # Aplicar migrations
npx prisma db seed   # Popular dados iniciais
```

---

## 3. Adicionar Novas Features

### 3.1 Nova Rota/Endpoint

```javascript
// 1. Criar schema de validação
// src/schemas/novo-feature.schemas.js
const z = require('zod');

const NovoSchema = z.object({
  campo1: z.string().email(),
  campo2: z.number().positive()
});

module.exports = { NovoSchema };

// 2. Criar controller
// src/controllers/NovoController.js
const { prisma } = require('../services/database');

class NovoController {
  static async criar(req, res) {
    try {
      const { campo1, campo2 } = req.validatedBody;

      const resultado = await prisma.novo.create({
        data: { campo1, campo2 }
      });

      res.json(resultado);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = NovoController;

// 3. Criar rota
// src/routes/novoRoutes.js
const express = require('express');
const NovoController = require('../controllers/NovoController');
const { validateBody } = require('../middleware/validation.middleware');
const { NovoSchema } = require('../schemas/novo-feature.schemas');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/novo', loginLimiter, validateBody(NovoSchema), NovoController.criar);

module.exports = router;

// 4. Registrar rota em server.js
app.use('/api/novo', require('./src/routes/novoRoutes'));
```

### 3.2 Adicionar Camada de Cache

```javascript
// Em qualquer serviço
const { get, set, del } = require('../services/cache.service');
const { CacheKeys } = require('../services/cache.service');

async function obterDados(id) {
  // Verificar cache primeiro
  const cached = await get(CacheKeys.USER(id));
  if (cached) return cached;

  // Se não está em cache, buscar do banco
  const data = await prisma.user.findUnique({ where: { id } });

  // Salvar em cache por 1 hora
  if (data) {
    await set(CacheKeys.USER(id), data, 3600);
  }

  return data;
}
```

### 3.3 Adicionar Auditoria

```javascript
// Em qualquer ação importante
const { logAuditEvent, AuditAction } = require('../services/auditLog.service');

async function deletarUsuario(usuarioId, executadoPor) {
  // Realizar ação
  await prisma.user.delete({ where: { id: usuarioId } });

  // Registrar auditoria
  await logAuditEvent({
    action: AuditAction.USER_DELETE,
    userId: executadoPor,
    targetUserId: usuarioId,
    resource: 'User',
    resourceId: usuarioId,
    status: 'success',
    context: { motivo: 'Encerramento de contrato' }
  });
}
```

### 3.4 Adicionar Validação em um Endpoint Existente

```javascript
// src/routes/chamaExistente.js
const { validateQuery } = require('../middleware/validation.middleware');
const z = require('zod');

const QuerySchema = z.object({
  limit: z.string().transform(Number).optional().default('20'),
  offset: z.string().transform(Number).optional().default('0')
});

router.get('/dados', validateQuery(QuerySchema), async (req, res) => {
  const { limit, offset } = req.validatedQuery;
  // limit e offset são validados e tipados
});
```

---

## 4. Segurança e Performance

### 4.1 Rate Limiting Customizado

```javascript
// Para um novo endpoint que requer limite customizado
const { rateLimit } = require('express-rate-limit');

const meuLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 requisições
  message: 'Muitas requisições, tente depois'
});

router.post('/endpoint-critico', meuLimiter, controlador.handler);
```

### 4.2 Validação de Entrada Customizada

```javascript
// src/schemas/custom.schemas.js
const z = require('zod');

const TransferenciaSchema = z
  .object({
    valor: z.number().positive(),
    contaDestino: z.string().min(10)
  })
  .refine((data) => data.valor <= 10000, { message: 'Valor máximo é R$ 10.000' });

module.exports = { TransferenciaSchema };
```

### 4.3 Hash de Senhas

```javascript
// Para operações com senhas
const bcrypt = require('bcrypt');

// Hash ao criar/atualizar
const hash = await bcrypt.hash(senha, 10);

// Verificar ao fazer login
const senhaCorreta = await bcrypt.compare(senhaFornecida, hashArmazenado);
```

---

## 5. Monitoring e Debugging

### 5.1 Verificar Logs com Correlation ID

```bash
# Todos os logs de uma requisição específica
grep "correlationId-123456" logs/app.log | jq .

# Logs de um usuário específico
grep "userId.*user_456" logs/app.log

# Erros importantes
grep "ERROR\|CRITICAL" logs/app.log
```

### 5.2 Auditoria - Relatórios

```javascript
const { AuditQueries } = require('../services/auditLog.service');

// Todas as ações de um usuário
const eventos = await AuditQueries.getUserEvents('user_123', 'tenant_456');

// Ações em um recurso específico
const edits = await AuditQueries.getResourceEvents('tenant_456', 'Conversation', 'conv_789');

// Relatório por período
const relatorio = await AuditQueries.getActivityReport(
  'tenant_456',
  new Date('2024-01-01'),
  new Date('2024-01-31')
);
```

### 5.3 Métricas de Cache

```javascript
// Em um endpoint ou middleware
const { cache } = require('../services/cache.service');

// Ver estatísticas
console.log(`Cache HIT RATE: ${cache.hitRate}%`);
console.log(`Cache SIZE: ${cache.size} items`);

// Limpar cache se necessário
await cache.invalidatePattern('user:*');
```

---

## 6. Debugging Common Issues

### 6.1 "Cannot find module"

```javascript
// Problema: require('../services/auditLog')
// Solução: Verificar path exato
require('../src/services/auditLog.service');

// Em testes
require('../src/services/auditLog.service');
```

### 6.2 "Validation error"

```javascript
// O middleware validation retorna 400 com detalhes
// Verificar req.validatedBody, req.validatedQuery, req.validatedParams

// Para debugar schema
const { LoginSchema } = require('../schemas/auth.schemas');
const result = LoginSchema.safeParse(dados);
if (!result.success) {
  console.log('Erros:', result.error.errors);
}
```

### 6.3 "Rate limit exceeded"

```javascript
// Verificar headers de rate limit na resposta
// X-RateLimit-Limit: 5
// X-RateLimit-Remaining: 2
// X-RateLimit-Reset: 1707650400

// Aumentar limite em .env se necessário
RATE_LIMIT_LOGIN=10  # Aumentar de 5 para 10
```

### 6.4 Database Connection Issues

```bash
# Verificar variável de ambiente
echo $DATABASE_URL

# Testar conexão
psql $DATABASE_URL -c "SELECT 1"

# Ver status de migrations
npx prisma migrate status

# Reset (CUIDADO - deleta dados!)
npx prisma migrate reset
```

---

## 7. Deployment Checklist

Antes de fazer deploy:

```bash
# 1. Certeza que tudo está commitado
git status

# 2. Rodar quality checks
npm run quality

# 3. Version bump
npm version patch|minor|major

# 4. Build e testes
npm run build
npm run test

# 5. Verificar variáveis de env em produção
envsubst < .env.production.template > .env.production

# 6. Tag e push
git tag v2.0.1
git push origin main v2.0.1

# 7. Deploy (via CI/CD)
# GitHub Actions automaticamente faz deploy
```

---

## 8. Escalando para Milhões de Requisições

### 8.1 Database Optimization

```sql
-- Adicionar índices conforme necessário
CREATE INDEX CONCURRENTLY idx_user_tenant ON User(tenantId);
CREATE INDEX CONCURRENTLY idx_message_conv_date ON Message(conversationId, createdAt);

-- Particionar tabelas grandes
CREATE TABLE Message_2024_Q1 PARTITION OF Message
  FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');
```

### 8.2 Redis Clustering

```bash
# Para escalar horizontalmente
redis-cli --cluster create 127.0.0.1:7000 127.0.0.1:7001 ...
```

### 8.3 Load Balancing

```javascript
// Usar nginx ou load balancer AWS/GCP/Azure
// Configuração nginx
upstream broker_backend {
  server broker1:3000;
  server broker2:3000;
  server broker3:3000;
}
```

---

## 9. Troubleshooting Reference

| Problema                   | Solução                                              |
| -------------------------- | ---------------------------------------------------- |
| Servidor não inicia        | Verificar `npm install`, porta em uso, DB connection |
| Testes falhando            | Verificar `.env.test`, banco de dados, mocks         |
| Memory leak                | Verificar listeners não removidos, cache infinito    |
| Slow queries               | Adicionar índices, cache, pagination                 |
| Rate limit muito agressivo | Aumentar `max` em rateLimiters.js                    |
| CORS errors                | Verificar `FRONTEND_URL` em .env, headers            |

---

## 10. Contatos e Suporte

**Tech Lead**: João Silva (joao@broker.com)
**DevOps**: Maria Santos (devops@broker.com)
**Security**: Carlos Oliveira (security@broker.com)

**Canais de Comunicação**:

- Slack: #tech-broker
- Jira: Project-BROKER
- GitHub: Issues com label `maintenance`

---

**Última Atualização**: 2024-02-11
**Versão Compatível**: v2.0.0+
**Mantido por**: Development Team
