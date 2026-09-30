# 🛡️ Guia 5: Segurança, Auditoria de Logs e Conformidade LGPD/GDPR

Este guia descreve os controles de proteção do **Broker** para garantir segurança da informação e conformidade com a LGPD (Lei Geral de Proteção de Dados) e GDPR.

---

## 🚦 1. Políticas de Rate Limiting (Controle de Vazão)

Para evitar ataques de negação de serviço (DoS/DDoS) e abuso de APIs, configuramos limitadores distribuídos usando o Redis no [rateLimiters.js](file:///c:/Users/Striker/Documents/Broker/Broker/src/middleware/rateLimiters.js):

| Escopo / Rota | Janela de Tempo | Limite Máximo | Finalidade Principal |
| :--- | :--- | :--- | :--- |
| **Global API** (`/api/*`) | 1 minuto | `300 requisições` | Proteção geral de rotas autenticadas |
| **Webhooks** (`/webhook/*`) | 1 minuto | `1000 requisições` | Suporte a picos de recebimento de mensagens Meta |
| **Envio de Chats** (`/api/chats/*/send`) | 1 minuto | `100 envios` | Evitar scripts maliciosos enviando spam |
| **Upload de Mídias** (`/api/media/upload`) | 1 hora | `50 uploads` | Proteger contra exaustão de armazenamento em disco |
| **Ações Admin** (`/api/admin/*`) | 1 minuto | `5000 requisições` | Permitir sincronizações de cargas pesadas autorizadas |
| **Login** (`/api/auth/login`) | 5 minutos | `5 tentativas` | Bloquear tentativas de brute force (limite por IP/dispositivo) |
| **Esqueci Senha** (`/api/auth/password-reset`)| 1 hora | `3 tentativas` | Prevenir spam de requisições de reset |

---

## 🇧🇷 2. Módulo de Proteção de Dados (LGPD / GDPR)

O [LGPDController.js](file:///c:/Users/Striker/Documents/Broker/Broker/src/controllers/LGPDController.js) oferece as funcionalidades necessárias para atender os direitos dos titulares de dados pessoais diretamente pelo painel administrativo:

### 2.1 Direito de Portabilidade (`GET /api/lgpd/export/:contactId`)
- **Ação**: Compila recursivamente todos os dados pessoais associados ao contato:
  - Cadastro de contato (Nome, telefone, campos personalizados).
  - Histórico completo de conversas (Transcrição de textos, links de mídias enviadas/recebidas).
  - Logs de transferências internas de suporte.
- **Formato de Saída**: Retorna um JSON estruturado para importação ou entrega ao cliente final.

### 2.2 Direito ao Esquecimento (`POST /api/lgpd/anonymize/:contactId`)
- **Ação**: Anonimiza de forma irreversível os dados cadastrais do contato.
- **Transação no Banco**:
  - Os campos `name`, `phone` e `customFields` na tabela `Contact` são limpos ou criptografados.
  - Para evitar furos de contabilidade e relatórios financeiros (SaaS billing), o histórico de faturamento de mensagens é mantido, mas o conteúdo real dos textos das mensagens (`Message.content`) é substituído por: `"Conteúdo deletado conforme solicitação de privacidade LGPD do cliente"`.
  - Quaisquer arquivos de mídias baixados do cliente e persistidos localmente na pasta `/uploads` são apagados fisicamente.

---

## 📝 3. Registro e Auditoria de Ações Administrativas (Audit Logs)

Qualquer alteração crítica realizada por administradores ou supervisores é registrada no banco de dados na tabela de auditoria através do `auditLog.service.js`.

### Eventos Auditados:
- **`USER_LOGIN` / `USER_LOGOUT`**: Registro de logins com endereço de IP.
- **`CONFIGURATION_UPDATE`**: Alterações em tokens ou configurações de integração Meta.
- **`URA_FLOW_UPDATE`**: Modificações lógicas na árvore de estados da URA.
- **`CONTACT_DELETE` / `CONTACT_ANONYMIZE`**: Ações vinculadas a remoção ou anonimização de contatos (LGPD).
- **`TENANT_CREATE`**: Criação de novas contas corporativas SaaS (exclusivo para `SUPER_ADMIN`).

### Retenção de Logs:
Seguindo as normas de conformidade regulatória:
- Logs de acesso e segurança são mantidos em banco de dados ativo por no mínimo **24 meses**.
- Transcripts de chats podem ter regras de retenção automática configuráveis por tenant (de 1 a 12 meses) de acordo com o plano contratado.
