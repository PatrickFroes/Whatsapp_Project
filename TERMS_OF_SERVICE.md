# Termos de Serviço - Broker WhatsApp SaaS Platform

**Versão**: 1.0  
**Data de Vigência**: 17 de abril de 2026  
**Última Atualização**: 17 de abril de 2026

---

## 📋 ÍNDICE

1. [Aceitação dos Termos](#1-aceitação-dos-termos)
2. [Descrição do Serviço](#2-descrição-do-serviço)
3. [Elegibilidade e Responsabilidades do Usuário](#3-elegibilidade-e-responsabilidades-do-usuário)
4. [Contas de Usuário e Segurança](#4-contas-de-usuário-e-segurança)
5. [Planos e Preços](#5-planos-e-preços)
6. [Pagamento e Faturamento](#6-pagamento-e-faturamento)
7. [Direitos de Propriedade Intelectual](#7-direitos-de-propriedade-intelectual)
8. [Restrições de Uso](#8-restrições-de-uso)
9. [Conduta Proibida](#9-conduta-proibida)
10. [Limitação de Responsabilidade](#10-limitação-de-responsabilidade)
11. [Indenização](#11-indenização)
12. [Interrupção de Serviço](#12-interrupção-de-serviço)
13. [Rescisão](#13-rescisão)
14. [Modificação dos Termos](#14-modificação-dos-termos)
15. [Lei Aplicável](#15-lei-aplicável)
16. [Contato](#16-contato)

---

## 1. ACEITAÇÃO DOS TERMOS

1.1 Ao acessar, registrar-se ou usar o Broker WhatsApp SaaS Platform ("**Serviço**"), você aceita estar vinculado a estes Termos de Serviço ("**Termos**"), nossa Política de Privacidade e quaisquer outras políticas ou diretrizes publicadas.

1.2 Se você não concordar com qualquer parte destes Termos, você não pode usar o Serviço.

1.3 Se você está usando o Serviço em nome de uma organização, você representa e garante que tem autoridade para vincular essa organização a estes Termos.

---

## 2. DESCRIÇÃO DO SERVIÇO

2.1 **Plataforma SaaS**: O Broker é uma plataforma de Contact Center multi-tenant hospedada em nuvem que permite aos usuários gerenciar comunicações via WhatsApp Business Cloud API.

2.2 **Funcionalidades Principais**:
- Gestão de múltiplos tenants isolados
- Painel administrativo com controle de permissões
- Integração nativa com WhatsApp Business API
- Histórico de conversas e análise
- Sistema de templates e respostas rápidas
- Automação via fluxos de trabalho
- Relatórios e analytics
- Gestão de usuários e papéis
- Sistema de billing por mensagem/usuário
- Real-time socket para atualizações

2.3 **Disponibilidade**: O Serviço é fornecido "como está" (as-is) com suporte a horário comercial conforme definido em contrato separado.

2.4 **Atualizações**: Nos reservamos o direito de atualizar, modificar ou descontinuar funcionalidades do Serviço com notificação prévia.

---

## 3. ELEGIBILIDADE E RESPONSABILIDADES DO USUÁRIO

3.1 **Elegibilidade Mínima**:
- Você deve ter pelo menos 18 anos de idade
- Deve ser uma pessoa legalmente capaz de contratar
- Não pode estar sob sanções econômicas ou lista de bloqueio
- Deve ser residente em jurisdição onde o Serviço é permitido

3.2 **Responsabilidades do Usuário**:
- Manter a confidencialidade de suas credenciais de acesso
- Não compartilhar sua senha ou token de autenticação
- Notificar imediatamente sobre qualquer acesso não autorizado
- Usar o Serviço apenas para fins legítimos e autorizados
- Cumprir todas as leis e regulamentos aplicáveis

3.3 **Registro de Conta**:
- Você é responsável pelas informações fornecidas durante o registro
- Você deve manter suas informações de contato atualizadas
- Você é responsável por todos os acessos realizados em sua conta

---

## 4. CONTAS DE USUÁRIO E SEGURANÇA

4.1 **Tipos de Contas**:
- **OWNER**: Proprietário do tenant, acesso total
- **ADMIN**: Administrador, gerenciamento de usuários e configurações
- **SUPERVISOR**: Supervisa agentes, relatórios e performance
- **AGENT**: Operador de atendimento
- **SUPER_ADMIN**: Gerenciador de todos os tenants (reservado para Broker)

4.2 **Credenciais**:
- Todas as senhas devem conter no mínimo 8 caracteres com números e letras maiúsculas
- Senhas são armazenadas com hash bcrypt (sal 10)
- Tokens JWT expiram em 24 horas
- Você pode resetar sua senha a qualquer momento

4.3 **Segurança**:
- Todas as conexões usam HTTPS/TLS
- Dados em trânsito são criptografados
- Dados sensíveis são mascarados na interface
- Implementamos rate limiting para proteger contra ataques
- Logging de auditoria em 20+ tipos de ações

4.4 **Acesso Não Autorizado**:
- Você é responsável por toda atividade em sua conta
- Notifique-nos imediatamente de acessos não autorizados
- Não somos responsáveis por perdas resultantes de uso não autorizado

---

## 5. PLANOS E PREÇOS

5.1 **Modelos de Preço**:
- **Custo por Mensagem**: Cobrado por cada mensagem enviada via WhatsApp OUT
- **Custo por Usuário**: Cobrado por cada usuário cadastrado por mês
- **Modelo Híbrido**: Combinação de ambos conforme contrato

5.2 **Planos Disponíveis**:
- **Free**: Uso limitado para avaliação (sujeito a limites de uso justo)
- **Starter**: Para pequenas equipes
- **Professional**: Para operações médias
- **Enterprise**: Customizado para grandes volumes

5.3 **Moedas Suportadas**:
- BRL (Real Brasileiro) - padrão
- USD (Dólar Americano)
- EUR (Euro)
- Conversão: Taxa de mercado no dia da fatura

5.4 **Inclusões Padrão**:
- Armazenamento de conversas: 12 meses
- Relatórios básicos: unlimited
- Usuários: conforme plano
- Webhooks e API: accesso completo
- Suporte: conforme SLA do plano

---

## 6. PAGAMENTO E FATURAMENTO

6.1 **Ciclo de Faturamento**:
- Faturamento mensal no primeiro dia do mês
- Faturamento trimestral para contratos Enterprise
- Data de renovação será indicada na fatura

6.2 **Método de Pagamento**:
- Cartão de crédito (Visa, Mastercard, Elo)
- Transferência bancária (para Enterprise)
- PIX (Brasil)
- Boleto (Brasil)

6.3 **Obrigação de Pagamento**:
- Você é responsável por manter seu método de pagamento ativo
- Faturamento falho resultará em suspensão de serviço
- Juros de 2% ao mês em pagamentos atrasados (máx. 20%)
- Após 30 dias de atraso, sua conta será suspensa
- Após 60 dias, sua conta será encerrada

6.4 **Reembolsos**:
- Mensagens enviadas não são reembolsáveis (serviço consumido)
- Cancelamento no mês: sem reembolso (uso pro-rata)
- Falha de serviço: créditos aplicados na próxima fatura
- Política de 30 dias de satisfação para novos planos

6.5 **Aumento de Preços**:
- Preços podem ser ajustados com notificação de 30 dias
- Clientes existentes não são afetados durante esse período
- Novo preço se aplica na próxima renovação
- Você pode cancelar se discordar

6.6 **Impostos**:
- Você é responsável por impostos aplicáveis em sua jurisdição
- Para usuários na UE: ICMS será aplicado
- Para usuários no Brasil: PIS/COFINS será aplicado
- Preços podem não incluir impostos (indicado no checkout)

---

## 7. DIREITOS DE PROPRIEDADE INTELECTUAL

7.1 **Nossa Propriedade**:
- O Broker, incluindo código, design, logos e documentação, é nossa propriedade intelectual
- Licenciado a você sob licença limitada e não exclusiva
- Você não pode copiar, modificar, distribuir ou vender o Serviço

7.2 **Sua Propriedade**:
- Você retém os direitos sobre seus dados: mensagens, conversas, contatos
- Você nos concede licença para usar esses dados para fornecer o Serviço
- Você garante que possui ou tem permissão para usar todo conteúdo que você carrega

7.3 **Consentimento de Contatos**:
- Você é exclusivamente responsável por obter consentimento dos contatos
- Você garante que tem direito de enviar mensagens via WhatsApp
- Violações podem resultar em bloqueio de sua conta

7.4 **Feedback**:
- Qualquer feedback ou sugestão que você forneça pode ser usado por nós
- Você concede permissão para implementar sugestões sem compensação

---

## 8. RESTRIÇÕES DE USO

8.1 **Proibições Gerais**:
Você não pode:
- Usar o Serviço para atividades ilegais ou não autorizadas
- Acessar sem permissão sistemas ou dados de terceiros
- Transmitir malware, vírus ou código malicioso
- Fazer engenharia reversa, decompilação ou desassembly
- Criar obras derivadas do Serviço
- Vender, alugar, emprestar ou transferir sua conta
- Usar bots ou scrapers sem permissão
- Tentar contornar limites de rate ou quotas

8.2 **Conteúdo Proibido**:
Não é permitido enviar mensagens contendo:
- Conteúdo ilegal ou que viole direitos de terceiros
- Spam ou comunicações em massa não solicitadas (conforme LGPD/GDPR)
- Phishing, malware ou exploits
- Conteúdo sexualmente explícito ou abusivo
- Assédio, ameaças ou incitamento à violência
- Falsas informações ou fraude

8.3 **Restrições Geográficas**:
- Alguns países/regiões podem ter restrições na plataforma
- Você é responsável por cumprir restrições locais
- Acesso de países sancionados é proibido

---

## 9. CONDUTA PROIBIDA

9.1 **Atividades que Podem Resultar em Suspensão/Encerramento**:
- Envio de spam ou mensagens em massa não autorizadas
- Violação de diretrizes da Meta/WhatsApp
- Compartilhamento de credenciais com terceiros
- Ataques DDoS ou tentativas de hackeamento
- Violação de direitos de terceiros
- Fraude ou phishing
- Evasão de pagamento
- Violação repetida de Termos

9.2 **Processo de Violação**:
1. Primeira violação: Aviso formal
2. Segunda violação: Suspensão de 7-30 dias
3. Terceira violação: Encerramento permanente
4. Violações graves (fraude, ataque): Encerramento imediato

9.3 **Direito de Recuso**:
- Você pode contestar uma violação dentro de 14 dias
- Apresente evidências ou argumentos por email
- Decisão final após review por nossa equipe de compliance

---

## 10. LIMITAÇÃO DE RESPONSABILIDADE

10.1 **"COMO ESTÁ"**:
O Serviço é fornecido "como está" sem garantias de qualquer tipo, expressas ou implícitas.

10.2 **Isenções de Responsabilidade**:
Não nos responsabilizamos por:
- Perda de dados (você é responsável por backups)
- Indisponibilidade de serviço por força maior
- Atos de terceiros, incluindo Meta/WhatsApp
- Uso inadequado do Serviço
- Consequências indiretas ou punitivas

10.3 **Limite de Indenização**:
Nossa responsabilidade total não excede o valor que você pagou nos últimos 3 meses de serviço.

10.4 **Uptime SLA**:
- Garantia de 99.5% de uptime (mensal)
- Excluindo manutenção programada e força maior
- Crédito de serviço se abaixo de SLA

---

## 11. INDENIZAÇÃO

11.1 Você concorda em indenizar e manter a Broker isenta de:
- Reclamações de terceiros sobre violação de direitos
- Uso inadequado do Serviço
- Violação destes Termos
- Dano causado por suas ações ou omissões

11.2 Procedimento de Indenização:
- Notifique-nos imediatamente de qualquer reclamação
- Não resolva sem nossa aprovação
- Coopere razoavelmente na defesa

---

## 12. INTERRUPÇÃO DE SERVIÇO

12.1 **Razões para Suspensão Imediata**:
- Suspeita de fraude ou uso não autorizado
- Violação de termos de serviço da Meta/WhatsApp
- Não pagamento após período de graça
- Atividade maliciosa ou hacking
- Ordem judicial

12.2 **Período de Graça**:
- Você recebe notificação por email
- 3 dias para resolver antes de suspensão
- Dados permanecem acessíveis por 30 dias

12.3 **Recuperação**:
- Você pode contestar a suspensão dentro de 14 dias
- Após resolver a questão, o Serviço é restaurado
- Cobrança normal retoma após resolução

---

## 13. RESCISÃO

13.1 **Rescisão por Você**:
- Você pode cancelar a qualquer momento sem penalidade
- Cancele via painel de configurações
- Efeito: fim do próximo ciclo de faturamento
- Dados deletados após 30 dias (conforme GDPR/LGPD)

13.2 **Rescisão por Nós**:
- Por violação de Termos: notificação de 7 dias para resolver
- Sem causa: notificação de 60 dias
- Por força maior: notificação assim que possível

13.3 **Após Rescisão**:
- Acesso ao Serviço encerrado imediatamente
- Dados são deletados em 30 dias (conforme legislação)
- Você é responsável por fazer backup antes de cancelar
- Reembolso conforme política de pagamento

---

## 14. MODIFICAÇÃO DOS TERMOS

14.1 **Direito de Modificação**:
- Nos reservamos o direito de modificar estes Termos a qualquer tempo
- Modificações significativas requerem notificação de 30 dias
- Modificações de segurança podem ser imediatas

14.2 **Notificação**:
- Você será notificado por email e banner na plataforma
- Versão anterior permanece disponível para download

14.3 **Aceitação Contínua**:
- Continuar usando o Serviço após a mudança constitui aceitação
- Se discordar, você pode cancelar conforme seção 13.1

---

## 15. LEI APLICÁVEL

15.1 **Jurisdição**:
- Brasil: Estes Termos são regidos pelas leis da República Federativa do Brasil
- Disputa será resolvida sob arbítrio ou mediação
- Se arbitragem, sede em São Paulo
- Você consente com jurisdição não-exclusiva em São Paulo

15.2 **Conformidade Regulatória**:
- **LGPD**: Conforme Lei Geral de Proteção de Dados (Lei 13.709/2018)
- **GDPR**: Conforme Regulamento Geral de Proteção de Dados (UE 2016/679)
- **LGPD + WhatsApp**: Conforme diretrizes de envio de mensagens
- **Compliance**: Auditoria anual de conformidade

---

## 16. CONTATO

16.1 **Suporte ao Cliente**:
- Email: support@broker.amber.com.br
- Telefone: +55 11 XXXX-XXXX
- Horário: Segunda-sexta, 09:00-18:00 (Brasília)
- Response time: 24 horas (Free), 2 horas (Paid)

16.2 **Relatório de Abuso**:
- Email: abuse@broker.amber.com.br
- Assunto: "Violação de Termos"
- Investigação dentro de 48 horas

16.3 **Inquérito Legal**:
- Email: legal@broker.amber.com.br
- Sujeito a processo legal e confidencialidade

16.4 **Endereço Registro**:
```
Broker SaaS Platform
Av. Paulista, 1000 - São Paulo, SP
CEP 01311-100, Brasil
```

---

## APÊNDICE A: DEFINIÇÕES

| Termo | Definição |
|-------|-----------|
| **Broker** | Plataforma SaaS de Contact Center multi-tenant |
| **Tenant** | Organização/cliente isolado dentro do Broker |
| **Usuário** | Pessoa que acessa o Serviço em nome de um Tenant |
| **Serviço** | Toda a plataforma, APIs e funcionalidades oferecidas |
| **Dados do Usuário** | Mensagens, conversas, contatos e informações armazenadas |
| **Conteúdo** | Qualquer dado enviado ou recebido via Serviço |
| **WhatsApp API** | Meta WhatsApp Business Cloud API |
| **Mensagem OUT** | Mensagem enviada do Broker para WhatsApp |
| **Token** | Credencial de autenticação (JWT, API key, etc) |
| **Webhook** | Endpoint para receber eventos em tempo real |

---

## APÊNDICE B: SLA E UPTIME

| Métrica | Valor |
|---------|-------|
| Uptime Garantido | 99.5% mensal |
| RTO (Recovery Time) | 4 horas |
| RPO (Recovery Point) | 1 hora |
| Janela de Manutenção | Domingo 22:00-02:00 UTC |
| Crédito por Downtime | 10% da mensalidade (99.5-99%), 25% (<99%) |

---

## APÊNDICE C: SEGURANÇA E CONFORMIDADE

- ✅ Criptografia SSL/TLS para todos os dados em trânsito
- ✅ Criptografia de dados em repouso (AES-256)
- ✅ Autenticação JWT com expiração de 24h
- ✅ Rate limiting contra ataques DDoS
- ✅ WAF (Web Application Firewall) ativo
- ✅ Backup diário (retenção: 12 meses)
- ✅ Audit logging de todas as ações
- ✅ Conformidade com LGPD, GDPR, SOC2
- ✅ Penetration testing trimestral
- ✅ Certificado de segurança TLS 1.3+

---

## DOCUMENTO ASSINADO DIGITALMENTE

Versão: 1.0  
Hash SHA-256: [Será gerado no deploy]  
Data: 17 de abril de 2026  
Validade: Conforme lei aplicável

---

**ÚLTIMA MODIFICAÇÃO**: 17 de abril de 2026  
**PRÓXIMA REVISÃO**: 17 de janeiro de 2027

---

*Estes Termos de Serviço constituem o acordo completo entre você e o Broker. Termos anteriores são revogados. Se alguma disposição for inválida, as demais permanecem em vigência.*
