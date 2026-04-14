/\*\*

- DEPLOYMENT_GUIDE.md - Guia Completo de Deployment
-
- Documenta como fazer deploy da aplicação em diferentes ambientes
- e como configurar todas as variáveis de ambiente necessárias
  \*/

# Deployment Guide - WhatsApp Broker v2.0

## 1. Preparação Pré-Deployment

### 1.1 Checklist de Segurança

```bash
# Verificar se todas as variáveis de ambiente estão configuradas
- DATABASE_URL (PostgreSQL connection string)
- REDIS_URL (Redis connection string)
- JWT_SECRET (32+ caracteres aleatórios)
- WEBHOOK_SECRET (para validar webhooks WhatsApp)
- NGROK_TOKEN (para webhooks em desenvolvimento)
- NODE_ENV=production
```

### 1.2 Validar Build

```bash
npm run build          # Compilar TypeScript (se aplicável)
npm run quality        # ESLint + Prettier
npm run test          # Jest tests (alvo 60%+ coverage)
npm run test:integration  # Testes de integração
```

### 1.3 Atualizar Versão

```bash
npm version patch|minor|major
git tag v2.0.0
git push origin main v2.0.0
```

## 2. Banco de Dados

### 2.1 Preparação PostgreSQL

```bash
# Criar banco de dados
createdb broker_prod

# Executar migrações
npx prisma migrate deploy

# Seed inicial (opcional)
npx prisma db seed
```

### 2.2 Indexes de Performance (FASE 6)

```bash
npx prisma migrate dev --name add_performance_indexes

# Verificar indexes existentes
SELECT * FROM pg_indexes WHERE tablename = 'Conversation';
```

### 2.3 Backup Strategy

```bash
# Backup automático diário
0 2 * * * pg_dump broker_prod | gzip > /backups/broker_$(date +\%Y\%m\%d).sql.gz

# Testar restore
pg_restore /backups/broker_20240101.sql.gz
```

## 3. Deployment em Docker

### 3.1 Build da Imagem

```bash
docker build -t broker:2.0.0 .

# Com registry
docker tag broker:2.0.0 gcr.io/project/broker:2.0.0
docker push gcr.io/project/broker:2.0.0
```

### 3.2 Executar em Produção

```bash
docker run -d \
  --name broker-prod \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://user:pass@db:5432/broker_prod" \
  -e REDIS_URL="redis://redis:6379" \
  -e JWT_SECRET="$(openssl rand -base64 32)" \
  --restart unless-stopped \
  broker:2.0.0
```

### 3.3 Docker Compose (Recomendado)

```yaml
version: '3.8'

services:
  broker:
    image: broker:2.0.0
    ports:
      - '3000:3000'
    env_file: .env.production
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: broker_prod
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## 4. Deployment em Kubernetes

### 4.1 Criar Namespace e Secrets

```bash
kubectl create namespace broker
kubectl create secret generic broker-secrets \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  --from-literal=db-url="postgresql://..." \
  -n broker
```

### 4.2 Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: broker-api
  namespace: broker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: broker-api
  template:
    metadata:
      labels:
        app: broker-api
    spec:
      containers:
        - name: broker
          image: gcr.io/project/broker:2.0.0
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: 'production'
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: broker-secrets
                  key: db-url
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: broker-secrets
                  key: jwt-secret
          resources:
            requests:
              memory: '512Mi'
              cpu: '250m'
            limits:
              memory: '1Gi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
```

### 4.3 Service e Ingress

```yaml
apiVersion: v1
kind: Service
metadata:
  name: broker-service
  namespace: broker
spec:
  selector:
    app: broker-api
  ports:
    - port: 80
      targetPort: 3000
  type: LoadBalancer

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: broker-ingress
  namespace: broker
spec:
  ingressClassName: nginx
  rules:
    - host: api.broker.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: broker-service
                port:
                  number: 80
```

## 5. Variáveis de Ambiente

### 5.1 Arquivo .env.production

```bash
# Core
NODE_ENV=production
PORT=3000
SESSION_SECRET=$(openssl rand -base64 32)

# Database
DATABASE_URL="postgresql://broker:${DB_PASSWORD}@db.broker.com:5432/broker_prod"

# Redis (Cache)
REDIS_URL="redis://:${REDIS_PASSWORD}@redis.broker.com:6379/0"

# Authentication
JWT_SECRET=$(openssl rand -base64 32)
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=30d

# WhatsApp Meta
META_APP_ID=123456
META_APP_SECRET=$(openssl rand -base64 32)
META_BUSINESS_ACCOUNT_ID=456789
META_PHONE_NUMBER_ID=789012
WEBHOOK_SECRET=$(openssl rand -base64 32)

# URLs
WEBHOOK_URL=https://api.broker.com/webhook
FRONTEND_URL=https://broker.com

# Monitoring
APM_SERVER_URL=https://apm.broker.com
LOG_LEVEL=info
SENTRY_DSN=https://...

# Rate Limiting
RATE_LIMIT_LOGIN=5
RATE_LIMIT_REGISTER=3
RATE_LIMIT_WEBHOOK=1000

# Email (para password reset)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}
```

## 6. Health Checks e Monitoring

### 6.1 Health Check Endpoint

```javascript
// server.js
app.get('/health', async (req, res) => {
  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis
    const redis = require('redis').createClient();
    await redis.ping();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});
```

### 6.2 Monitoring com Prometheus

```javascript
// middleware/metrics.js
const promClient = require('prom-client');

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code']
});

module.exports.metricsMiddleware = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
  });
  next();
};

module.exports.metricsEndpoint = (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(promClient.register.metrics());
};
```

## 7. Rollback Strategy

### 7.1 Blue-Green Deployment

```bash
# Deploy nova versão (green)
docker tag broker:2.0.1 broker:green
docker run -d --name broker-green -p 3001:3000 broker:green

# Teste na green
curl http://localhost:3001/health

# Switch traffic (via nginx/load balancer)
# Se problema, volta para blue:
docker stop broker-green
```

### 7.2 Database Rollback

```bash
# Lista migrations aplicadas
npx prisma migrate status

# Rollback se necessário
npx prisma migrate resolve --rolled-back "20240101120000_migration_name"
```

## 8. Checklist Pós-Deployment

- [ ] Health checks respondendo 200 OK
- [ ] Logs aparecendo em centralizado (ELK, CloudWatch, etc)
- [ ] Métricas sendo coletadas (Prometheus)
- [ ] Alertas configurados para erros críticos
- [ ] Rate limiting funcionando
- [ ] Correlation IDs em logs
- [ ] Audit logs sendo persistidos
- [ ] Cache Redis hit rates aceitáveis (>80%)
- [ ] Backup automático configurado
- [ ] SSL/TLS certificado válido
- [ ] CORS configurado corretamente
- [ ] Integração WhatsApp testada
- [ ] Testes de carga executados

## 9. Incidentes Comuns e Resolução

### 9.1 Database Connection Timeout

```bash
# Aumentar pool size
DATABASE_URL="postgresql://user:pass@host/db?schema=public&connection_limit=20"

# Verificar conexões abertas
SELECT count(*) FROM pg_stat_activity;
```

### 9.2 Redis Memory Issues

```bash
# Verificar uso
redis-cli INFO memory

# Limpar cache se necessário
redis-cli FLUSHDB
```

### 9.3 High Latency Response

```bash
# Analisar slow queries
# No PostgreSQL: enable log_statement = 'all'

# Verificar indexes
EXPLAIN ANALYZE SELECT * FROM Conversation WHERE tenantId = '...';
```

## 10. Contatos e Escalation

- **DevOps**: devops@broker.com
- **Security**: security@broker.com
- **Database Team**: dba@broker.com
- **On-Call**: +55 11 98765-4321

---

Última atualização: 2024-02-11
Versão: 2.0.0
