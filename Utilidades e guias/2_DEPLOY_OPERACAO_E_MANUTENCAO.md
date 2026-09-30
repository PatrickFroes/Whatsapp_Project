# ⚙️ Guia 2: Instalação, Deploy, Operação e Manutenção do Broker

Este guia consolida as instruções e comandos práticos para gerenciar a infraestrutura do **Broker WhatsApp SaaS** em ambientes de desenvolvimento e produção.

---

## 🐋 1. Orquestração e Containers (Docker)

O Broker utiliza o Docker Compose para isolar e executar a infraestrutura de apoio.

### Arquivo [docker-compose.yml](file:///c:/Users/Striker/Documents/Broker/Broker/docker-compose.yml)
- **`broker_app`**: Servidor Node.js na porta 3001. Limitado a `0.8` vCPU e `600MB` de RAM. Possui healthcheck automático apontando para `/api/health`.
- **`postgres`**: PostgreSQL 15 na porta 5432. Armazena dados persistentes no volume `postgres_data`.
- **`redis`**: Redis 7 na porta 6379 com senha habilitada (`--requirepass`) e política de despejo `allkeys-lru` limitando o uso de memória em `300MB`.
- **`nginx`**: Proxy reverso gerenciando tráfego HTTP/HTTPS e subida de túneis WebSocket.
- **`pgadmin`**: Interface de visualização do banco de dados exposta na porta 8080 (opcional).

### Comandos de Controle do Docker:
```bash
# Subir toda a infraestrutura em background
npm run docker:up

# Parar e remover todos os containers ativos
npm run docker:down

# Visualizar status de saúde dos containers e uso de recursos
docker ps
docker stats
```

---

## ⚙️ 2. Guia de Configuração de Ambiente (`.env`)

Copie o arquivo `.env.example` para `.env` e configure as seguintes variáveis obrigatórias:

| Variável | Tipo | Descrição | Exemplo de Valor |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | String | Modo da aplicação (`production` ou `development`) | `production` |
| `PORT` | Number | Porta de exposição da aplicação Express | `3001` |
| `DATABASE_URL` | String | String de conexão relacional PostgreSQL | `postgresql://postgres_admin:MinhaSenhaForte@localhost:5432/whatsapp_broker?schema=public` |
| `REDIS_URL` | String | String de conexão com o banco Redis | `redis://:SenhaForteRedis@localhost:6379` |
| `JWT_SECRET` | String | Segredo para cifrar tokens de autenticação | `openssl rand -base64 32` |
| `ALLOWED_ORIGINS` | String | Whitelist CORS separada por vírgula | `https://broker.meudominio.com,http://localhost:3001` |

---

## 🌐 3. Servidor Web e Proxy Reverso (Nginx + SSL Let's Encrypt)

O Nginx gerencia a terminação SSL (forçando TLS 1.3) e atua como gateway de entrada.

### Configuração Recomendada de Upstream no Nginx
Certifique-se de que o bloco de conexão no `/etc/nginx/sites-available/broker` (ou mapeado no [nginx.conf](file:///c:/Users/Striker/Documents/Broker/Broker/nginx.conf)) configure corretamente o tráfego do Socket.io para evitar quedas no painel do agente:

```nginx
server {
    listen 443 ssl http2;
    server_name broker.meudominio.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Encaminhamento padrão da API e arquivos estáticos
    location / {
        proxy_pass http://broker_app:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Bloco obrigatório para subida de WebSockets (Socket.io)
    location /socket.io {
        proxy_pass http://broker_app:3001/socket.io;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 🧠 4. Otimização de Memória NodeJS para Servidores Pequenos

Servidores VPS pequenos (ex: 2GB de RAM) podem sofrer travamentos quando o Node.js consome o limite padrão de Heap Memory do V8. Implementamos duas otimizações ativas no [server.js](file:///c:/Users/Striker/Documents/Broker/Broker/server.js):

1. **Aviso de Sobrecarga**: O servidor monitora a memória heap a cada 30 segundos. Caso o uso ultrapasse 85% do alocado, o logger grava um alerta do tipo `warn` em disco.
2. **Garbage Collection Manual**: Caso o Node seja executado em ambiente de produção exposto ao coletor, o servidor dispara uma varredura manual agressiva (`global.gc()`) a cada **5 minutos** para desocupar memória heap inativa de downloads e sessões expiradas.

> ⚠️ **Execução Crítica**: Habilite o coletor em produção adicionando a flag `--expose-gc` no comando de execução do servidor (ou configurações de ecossistema do PM2):
> `node --expose-gc server.js`

---

## 🛡️ 5. Segurança do Host e Firewall (UFW)

Para blindar o servidor VPS contra acessos indevidos e varreduras de portas:

```bash
# 1. Negar todas as conexões de entrada por padrão
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 2. Liberar portas necessárias
sudo ufw allow 22/tcp   # SSH (Substitua se usar porta customizada)
sudo ufw allow 80/tcp   # HTTP (Necessário para renovação Let's Encrypt)
sudo ufw allow 443/tcp  # HTTPS (Nginx Proxy)

# 3. Habilitar o firewall
sudo ufw enable
```

### Configuração de Tempo Limite do SSH (Anti-Hang)
Evite sessões pendentes no console do Linux adicionando as seguintes linhas no arquivo `/etc/ssh/sshd_config`:
```text
ClientAliveInterval 300
ClientAliveCountMax 2
```
*Isso encerra conexões inativas automaticamente após 10 minutos (5 cliques de 300 segundos).*

---

## 🔑 6. Gerenciamento de Banco de Dados e Super Administrador

### Inicialização e Sincronização do Banco:
```bash
# Executa migrações pendentes no banco e atualiza o Prisma Client
npm run setup
```

### Criar o Super Administrador (Seeding):
A conta inicial de administrador geral do SaaS é gerada através da semente (seed) do Prisma:
```bash
npm run db:seed
```
*Este comando cria o usuário padrão no tenant principal. As credenciais padrões estão definidas no arquivo script correspondente.*

### Resetar Senha do Administrador (Caso Esqueça):
Se precisar resetar manualmente uma senha de usuário administrativo, você pode utilizar o utilitário Prisma Studio para editar o hash de senha gerado (bcrypt com salt 10) ou executar o script auxiliar via terminal:
```bash
node scripts/reset_password.js --email="admin@empresa.com" --password="MinhaNovaSenha123!"
```
*(Certifique-se de que o script esteja carregado na pasta de scripts e que a string de conexão no `.env` esteja ativa).*
