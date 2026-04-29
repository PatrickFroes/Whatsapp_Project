# 🛡️ GUIA DE CONFORMIDADE E TRATAMENTO DE DADOS

**Broker WhatsApp SaaS Platform**  
**Versão**: 1.0  
**Data**: 17 de abril de 2026

---

## 📋 SUMÁRIO EXECUTIVO

Este documento complementa o **Termos de Serviço** e a **Política de Privacidade** do Broker, detalhando como a plataforma atende requisitos regulatórios de:

- 🇧🇷 **LGPD** (Lei Geral de Proteção de Dados - Lei 13.709/2018)
- 🇪🇺 **GDPR** (Regulamento Geral de Proteção de Dados - EU 2016/679)
- 🔐 **Conformidade Meta/WhatsApp** (Business Platform Policies)
- 📱 **TCPA** (Telephone Consumer Protection Act - USA)

---

## 1. CONFORMIDADE LGPD (Brasil)

### 1.1 Base Legal para Tratamento de Dados

| Tipo de Dado | Base Legal | Tratamento | Exemplo |
|--------------|-----------|-----------|---------|
| **Contatos/Telefone** | Consentimento | Necessário | +55 11 98765-4321 |
| **Mensagens** | Consentimento | Necessário | Histórico de chat |
| **Dados de Conta** | Legítimo interesse | Necessário | Dados de login |
| **Billing** | Obrigação legal | Necessário | Fatura, recibo |
| **Cookies** | Consentimento | Necessário | Rastreamento |

### 1.2 Direitos do Titular de Dados

O Broker fornece os seguintes direitos via painel de administrador:

#### 1.2.1 Direito de Acesso
- **Endpoint**: `GET /api/admin/contacts/{contactId}/data`
- **Formato**: JSON estruturado
- **Tempo**: Máximo 15 dias
- **Implementação**: ✅ Completo

Exemplo de resposta:
```json
{
  "contact": {
    "id": "uuid",
    "phone": "{{masked}}",
    "name": "João Silva",
    "createdAt": "2026-01-15",
    "tags": ["cliente", "vip"],
    "conversations": [...]
  },
  "messages": [...],
  "systemLogs": [...]
}
```

#### 1.2.2 Direito de Retificação
- **Endpoint**: `PUT /api/admin/contacts/{contactId}`
- **Campo**: Todos os campos customizáveis
- **Tempo**: Imediato
- **Implementação**: ✅ Completo

Campos editáveis:
- Nome
- Tags
- Campos customizados
- Notas internas (revisadas)

#### 1.2.3 Direito ao Esquecimento (Exclusão)
- **Endpoint**: `DELETE /api/admin/contacts/{contactId}` (com confirmação)
- **Escopo**: Dados pessoais completos
- **Tempo**: Máximo 30 dias
- **Implementação**: ✅ Completo
- **Processo**:
  1. Admin inicia exclusão
  2. Sistema envia email de confirmação
  3. Após 7 dias, dados são anonimizados
  4. Após 30 dias, dados são deletados permanentemente
  5. Backup histórico mantido por 12 meses (conforme lei)

#### 1.2.4 Direito à Portabilidade
- **Endpoint**: `GET /api/admin/export/contacts?format=json|csv`
- **Formato**: JSON ou CSV estruturado
- **Tempo**: Máximo 15 dias
- **Implementação**: ✅ Completo

Dados inclusos:
- Contatos (nome, telefone, tags, custom fields)
- Conversas (transcripts completos)
- Mensagens (timestamps, conteúdo)
- Interações com sistema

#### 1.2.5 Direito de Oposição
- **Endpoint**: `PUT /api/admin/contacts/{contactId}/preferences`
- **Opções**: Bloquear comunicações, desabilitar rastreamento
- **Implementação**: ✅ Completo

```json
{
  "preferences": {
    "receiveMarketing": false,
    "tracking": false,
    "thirdPartySharing": false
  }
}
```

### 1.3 Obrigações do Broker (Controlador)

| Obrigação | Implementação | Frequência |
|-----------|--------------|-----------|
| Manter registro de atividades | ✅ Audit log completo | Contínuo |
| Criptografar dados sensíveis | ✅ AES-256 | Contínuo |
| Fazer backup seguro | ✅ Diário com retenção 12m | Diário |
| Comunicar falha de segurança | ✅ Procedimento 72h | Quando ocorrer |
| Designar DPO | ✅ dpo@broker.com | Contínuo |
| AIPD quando aplicável | ✅ Documento salvo | Anual |

### 1.4 Aviso de Proteção de Dados (AIPD)

**Arquivo**: `/docs/AIPD_2026.pdf`

Inclui:
- Descrição de processamento
- Necessidade do tratamento
- Legitimidade do interesse
- Medidas de proteção
- Direitos e garantias dos titulares
- Riscos identificados

---

## 2. CONFORMIDADE GDPR (UE)

### 2.1 Artigos Principais Implementados

| Artigo | Requisito | Implementação | Status |
|--------|-----------|--------------|--------|
| **Art. 5** | Princípios (legalidade, transparência) | Termos + Privacy | ✅ |
| **Art. 6** | Base legal | Consentimento + legítimo interesse | ✅ |
| **Art. 12-22** | Direitos do titular | 5 direitos implementados | ✅ |
| **Art. 25** | Privacy by design | Padrão na arquitetura | ✅ |
| **Art. 32** | Medidas de segurança | TLS, AES-256, bcrypt | ✅ |
| **Art. 33** | Notificação de violação | Dentro de 72h | ✅ |
| **Art. 34** | Comunicação ao titular | Notificação automática | ✅ |
| **Art. 35** | AIPD quando necessário | Documento preparado | ✅ |
| **Art. 36** | Consulta prévia | Processo definido | ✅ |

### 2.2 Consentimento (Art. 7)

Mecanismo de consentimento implementado:

```
Fluxo de Consentimento:
┌─ Usuário tenta acessar
├─ Apresenta banner de cookies
├─ Opções: "Aceitar" | "Rejeitar" | "Customizar"
├─ Se Customizar:
│  ├─ [ ] Essencial (obrigatório)
│  ├─ [ ] Analytics
│  ├─ [ ] Marketing
│  └─ [ ] Preferências
└─ Salva consentimento em banco + cookie
```

**Dados de Consentimento**:
- Timestamp da aceitação
- IP do usuário
- User agent
- Versão do documento
- Hash do documento

### 2.3 Direito ao Esquecimento (Art. 17)

Processo completo implementado:

```
Fase 1: Requisição (Dia 0)
└─ Admin solicita exclusão de contato
   ├─ Sistema verifica se há litígio pendente
   ├─ Se sim: Notifica admin, adia
   └─ Se não: Inicia processo

Fase 2: Anonimização (Dia 1-3)
└─ Sistema anonimiza:
   ├─ Telefone → "masked_xxxx"
   ├─ Nome → "Deleted User"
   ├─ Email → Null
   ├─ Custom fields → Deletados
   └─ Mantém apenas UUID para auditoria

Fase 3: Exclusão Hard (Dia 30)
└─ Deleta permanentemente:
   ├─ Registros anonimizados
   ├─ Logs de transação
   ├─ Cache de sessão
   └─ Notifica admin com confirmação
```

### 2.4 Transferências Internacionais

**Declaração**: O Broker não faz transferências para fora da UE/Brasil sem:
1. Decisão de adequação da Comissão Europeia
2. Cláusulas contratuais padrão (SCCs) assinadas
3. Mecanismo de proteção complementar

**Atual**: Dados hospedados em São Paulo (Brasil) ✅

---

## 3. CONFORMIDADE WHATSAPP/META

### 3.1 Policies Implementadas

#### 3.1.1 Business Platform Policies
- ✅ Não enviar spam ou mensagens não solicitadas
- ✅ Respeitar rate limits da API
- ✅ Não coletar dados não autorizados
- ✅ Não enviar conteúdo proibido
- ✅ Não fazer phishing ou fraude

#### 3.1.2 Message Sending Guidelines
```
Autorizado:
✅ Confirmação de transação
✅ Atualização de pedido
✅ Suporte ao cliente
✅ Avisos importantes
✅ Notificações pessoais (com opt-in)

Proibido:
❌ Spam em massa
❌ Conteúdo sexual
❌ Phishing
❌ Malware
❌ Mensagens duplicadas
❌ Sem consentimento prévio
```

#### 3.1.3 Template Messages
- Suportados templates pré-aprovados
- Implementação: ✅ Completo
- System tracks template usage
- Análise diária de complaints

### 3.2 Monitoramento de Violações

| Métrica | Limite | Ação |
|---------|--------|------|
| **Complaints/week** | 0.5% | Warning |
| **Complaints/week** | 1% | Review modo |
| **Complaints/week** | 2% | Suspend account |
| **Ban rate** | 5% | Investigation |

---

## 4. DADOS PESSOAIS TRATADOS

### 4.1 Mapeamento de Dados

| Tipo | Categoria | Sensibilidade | Retenção | Proteção |
|------|-----------|---------------|----------|----------|
| **Telefone** | Contato | Media | 12m | AES-256 |
| **Nome** | Identificação | Baixa | 12m | Plaintext |
| **Email** | Contato | Media | 12m | AES-256 |
| **IP** | Rastreamento | Media | 90d | Hash |
| **Mensagens** | Conteúdo | Alta | 12m | AES-256 |
| **Cookies** | Tracking | Baixa | 24m | Encrypted |
| **Logs** | Auditoria | Alta | 12m | Secure |
| **Pagamentos** | Billing | Crítica | 72m | PCI-DSS |

### 4.2 Fluxo de Dados

```
Entrada:
┌─ Usuário envia mensagem
├─ Sistema recebe via API
├─ Criptografa (AES-256)
├─ Escreve em PostgreSQL
└─ Notifica via Socket.io

Processamento:
┌─ Sistema processa conteúdo
├─ Busca em índices (Redis)
├─ Log de auditoria
├─ Verifica consentimento
└─ Envia para WhatsApp via Meta API

Armazenamento:
┌─ PostgreSQL (dados estruturados)
├─ Redis (cache, sessões)
├─ Backup cloud (S3-like)
└─ Arquivo histórico (comprimido, AES-256)

Retenção:
┌─ Ativo: 12 meses
├─ Backup: 12 meses
├─ Auditoria: 24 meses
└─ Exclusão: Anonimização + hard delete
```

---

## 5. INCIDENTE DE SEGURANÇA

### 5.1 Procedimento de Resposta

```
T+0: Detecção
└─ Alert ativado
   ├─ Slack notification
   ├─ Email ao security team
   └─ Criar incident ticket

T+30min: Investigação
└─ Avaliar:
   ├─ Escopo da violação
   ├─ Dados afetados
   ├─ Número de usuários
   └─ Severidade (1-5)

T+4h: Decisão
└─ Se breach pessoal:
   ├─ SIM → Notificar autoridades + usuários
   └─ NÃO → Log interno, monitorar

T+72h: Notificação
└─ Enviar para:
   ├─ Autoridade regulatória (ANPD/ICO)
   ├─ Usuários afetados (email)
   └─ Imprensa (se crítico)

T+30d: Relatório
└─ Documentar:
   ├─ Root cause
   ├─ Impacto
   ├─ Medidas tomadas
   └─ Plano de prevenção
```

### 5.2 Comunicação com Titular

**Template de Email**:
```
Assunto: [IMPORTANTE] Informação de Segurança - Broker

Prezado(a),

Queremos informá-lo sobre um incidente de segurança que
pode ter afetado seus dados. Em [DATA], detectamos [DESCRIÇÃO].

Dados Afetados: [LISTA]
Ação Imediata: [AÇÕES TOMADAS]
Próximos Passos: [RECOMENDAÇÕES]

Contato: security@broker.com.br

Atenciosamente,
Broker Security Team
```

---

## 6. VENDOR MANAGEMENT (Sub-processadores)

### 6.1 Terceiros com Acesso a Dados

| Vendor | Dados | País | DPA | Status |
|--------|-------|------|-----|--------|
| **Meta** | Mensagens | USA | ✅ | Ativo |
| **PostgreSQL** | Todos | Brasil | ✅ | Ativo |
| **Redis** | Cache | Brasil | ✅ | Ativo |
| **Sentry** | Logs | USA | ✅ | Ativo |
| **Stripe** | Pagamentos | USA | ✅ | Ativo |

### 6.2 Data Processing Agreement (DPA)

Todos os vendors possuem DPA assinado contendo:
- Escopo de processamento
- Duração
- Natureza
- Finalidade
- Tipo de dados pessoais
- Categorias de titulares
- Obrigações de segurança
- Sub-processadores

**Arquivo**: `/contracts/DPA_Master_2026.pdf`

---

## 7. POLÍTICA DE RETENÇÃO DE DADOS

### 7.1 Tabela de Retenção

| Tipo | Retenção | Ação Após |
|------|----------|-----------|
| **Mensagens** | 12 meses | Deletar |
| **Contatos** | Indefinido* | Anonimizar se inativo 2 anos |
| **Logs de acesso** | 24 meses | Deletar |
| **Cookies** | 24 meses | Expirar |
| **Backups** | 12 meses | Destruir |
| **Audit logs** | 24 meses | Arquivar |

*Contatos ativos mantidos indefinidamente (legítimo interesse)

### 7.2 Processo de Limpeza

```
Automático (Cronjob):
└─ Daily at 02:00 UTC
   ├─ Busca registros com data_expiracao < TODAY
   ├─ Marca para anonimização
   ├─ Agenda exclusão após 30 dias
   ├─ Log audit: "RETENTION_CLEANUP"
   └─ Notifica admin

Manual (Admin):
└─ Dashboard > Data Management > Cleanup
   ├─ Preview de dados para deletar
   ├─ Confirmação de segurança (2FA)
   ├─ Executa ou agenda
   └─ Email confirmação após
```

---

## 8. TREINAMENTO E AWARENESS

### 8.1 Obrigações de Treinamento

| Role | Frequência | Conteúdo | Comprovante |
|------|-----------|----------|------------|
| **Todos** | Anual | LGPD/GDPR basics | Certificado |
| **Devs** | Semestral | Secure coding | Quiz |
| **Admins** | Trimestral | Compliance ops | Log |
| **Suporte** | Semestral | Privacy handling | Training |

### 8.2 Recurso de Treinamento

**Local**: `/admin/training`
- Video modules
- Quiz interativo
- Documentação
- FAQ

---

## 9. AUDITORIA E MONITORAMENTO

### 9.1 Auditorias Internas

| Tipo | Frequência | Foco |
|------|-----------|------|
| **Compliance** | Trimestral | LGPD/GDPR adherence |
| **Segurança** | Mensal | Access controls |
| **Operacional** | Semanal | Data handling |
| **Externo** | Anual | SOC2/ISO27001 |

### 9.2 Dashboard de Compliance

**URL**: `https://broker.internal/admin/compliance-dashboard`

Métricas rastreadas:
- GDPR checkboxes (% completo)
- LGPD checkboxes (% completo)
- Incidents reported (count)
- DPA coverage (%)
- Training completion (%)
- Data retention status

---

## 10. CONTATO DO DPO

**Data Protection Officer (DPO)**

```
Nome: [A designar]
Email: dpo@broker.com.br
Telefone: +55 11 [XXXX-XXXX]
Endereço: Av. Paulista, 1000 - São Paulo, SP

Horário Atendimento:
Segunda-Sexta: 09:00-18:00
Tempo resposta: 48 horas
```

---

## 11. DOCUMENTOS RELACIONADOS

- 📄 Política de Privacidade: `/frontend/privacy.html`
- 📄 Termos de Serviço: `TERMS_OF_SERVICE.md`
- 📄 AIPD: `/docs/AIPD_2026.pdf`
- 📄 DPA Master: `/contracts/DPA_Master_2026.pdf`
- 📄 Registro de Processamento: `/docs/PROCESSING_LOG_2026.md`

---

## 12. CHANGELOG CONFORMIDADE

| Data | Versão | Mudança | Status |
|------|--------|--------|--------|
| 17/04/2026 | 1.0 | Documento criado | Vigente |
| 01/05/2026 | 1.1 | Atualização GDPR | Planejado |
| 01/06/2026 | 1.2 | Auditoria externa | Planejado |

---

**Último Update**: 17 de abril de 2026  
**Próxima Revisão**: 17 de julho de 2026  
**Responsável**: Compliance Officer, Broker SaaS

---

*Este documento é confidencial e destina-se apenas a uso interno e de consultores autorizados.*
