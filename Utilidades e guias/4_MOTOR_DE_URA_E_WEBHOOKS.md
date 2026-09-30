# 🤖 Guia 4: Motor de URA (FlowEngine) e Integração de Webhooks

Este guia detalha o funcionamento do **FlowEngine V2** (chatbot de triagem por estados JSON) e o processamento de eventos do webhook da Meta Cloud API.

---

## 🏗️ 1. Estrutura de Estados da URA (FlowEngine JSON Schema)

A URA lê configurações estruturadas em árvore salvas no campo `flows` da tabela `Tenant`. O nó inicial obrigatório de leitura deve se chamar `"start"`.

### 📂 Especificação dos Nós Disponíveis:

#### 1. `text` (Mensagem Direta)
Envia uma mensagem simples e desvia a conversa imediatamente para o próximo nó.
```json
"start": {
  "type": "text",
  "message": "Olá, {{name}}! Seja bem-vindo ao suporte virtual da Amber.",
  "next": "menu_principal"
}
```

#### 2. `menu` (Menu de Opções Interativas)
Exibe opções clicáveis ou listas de seleção no WhatsApp.
```json
"menu_principal": {
  "type": "menu",
  "message": "Como podemos ajudar você hoje?",
  "options": {
    "Financeiro": "fluxo_financeiro",
    "Suporte Técnico": "fluxo_suporte",
    "Falar com Atendente": "encaminhar_humano"
  }
}
```
*Lógica de exibição:*
- $\le$ 3 opções: WhatsApp Interactive Buttons.
- 4 a 10 opções: WhatsApp List Messages.
- $>$ 10 opções: Texto numerado formatado.

#### 3. `collect_data` (Captura de Variáveis)
Faz uma pergunta ao cliente, valida a resposta com Regex e salva o valor no estado conversacional.
```json
"pergunta_cpf": {
  "type": "collect_data",
  "message": "Por favor, digite seu CPF (apenas números):",
  "data_key": "cpf_cliente",
  "validation_pattern": "^\\d{11}$",
  "validation_error": "❌ CPF inválido. Certifique-se de digitar exatamente 11 números:",
  "next": "consulta_api_cadastro"
}
```

#### 4. `conditional` (Desvios Lógicos Condicionais)
Avalia expressões matemáticas ou relacionais baseadas nas variáveis coletadas na conversa.
```json
"verifica_segmento": {
  "type": "conditional",
  "condition": "{{dados_plano}} === 'premium'",
  "if_true": "fila_prioritaria",
  "if_false": "fila_comum"
}
```
*Segurança*: O [SafeEvaluator.js](file:///c:/Users/Striker/Documents/Broker/Broker/src/services/SafeEvaluator.js) analisa a string substituída de forma estrita sem invocar a função insegura `eval()`. Apenas os operadores lógicos `===`, `!==`, `>`, `<`, `>=`, `<=`, `&&` e `||` são permitidos.

#### 5. `api_call` (Chamadas HTTP para Sistemas Externos)
Dispara integrações de dados via HTTP de forma síncrona (timeout padrão de 10 segundos).
```json
"consulta_api_cadastro": {
  "type": "api_call",
  "api_url": "https://api.empresa.com/clientes/{{cpf_cliente}}",
  "api_method": "GET",
  "api_save_var": "retorno_cadastro",
  "api_map_fields": {
    "nome_real": "nome",
    "dados_plano": "plano"
  },
  "on_error_next": "cpf_nao_cadastrado",
  "next": "verifica_segmento"
}
```

#### 6. `transfer_agent` / `transfer_queue` (Transição para Humano)
Encerra a execução do bot, altera o status da conversa no banco e aciona as filas de atendimento do Broker.
```json
"encaminhar_humano": {
  "type": "transfer_agent",
  "skill": "Suporte",
  "message": "Certo! Estou conectando você com a nossa equipe de suporte."
}
```

---

## ⏰ 2. Lógica de Validação de Horário Comercial

O [BusinessHoursService.js](file:///c:/Users/Striker/Documents/Broker/Broker/src/services/BusinessHoursService.js) é acionado a cada mensagem de entrada:
1. Se `businessHours.enabled === true`, o serviço avalia o dia da semana e horário atual baseando-se no `timezone` configurado (ex: `America/Sao_Paulo`).
2. Se estiver fora da janela útil, o sistema envia a mensagem automática `autoReplyMessage`.
3. A conversa é marcada com a flag `waitingForBusiness: true` e movida para a fila `QUEUED` sem passar pelo bot ou agentes. Ela permanecerá assim até que o cliente envie uma nova mensagem no próximo expediente comercial.

---

## 📡 3. Recepção e Integração de Webhooks da Meta

A rota de escuta de mensagens inbound da Meta está centralizada em `POST /webhook`.

### 3.1 Middleware de Segurança HMAC-SHA256
A Meta exige a validação da assinatura digital das mensagens. O [webhookHmac.middleware.js](file:///c:/Users/Striker/Documents/Broker/Broker/src/middleware/webhookHmac.middleware.js) intercepta o payload:
1. Extrai a assinatura do cabeçalho `X-Hub-Signature-256`.
2. Calcula o hash HMAC-SHA256 do corpo da requisição utilizando a chave `metaAppSecret` específica do inquilino.
3. Se os hashes não baterem, retorna `HTTP 401 Unauthorized` imediato, protegendo a aplicação contra injeções de payloads falsos.

### 3.2 Otimizações de Webhooks e Redundâncias
- **Anti-Duplicação**: O webhook monitora os IDs de mensagens enviados pela Meta (`wamid`). Caso um `wamid` já exista no banco, a requisição é ignorada para prevenir processamento duplicado decorrente de retentativas automáticas de entrega do gateway da Meta.
- **Redundância de Queda (Fallback de Atendimento)**: Caso o bot falhe ou a chamada HTTP do FlowEngine sofra timeout, a conversa é desviada para o status `QUEUED` e os supervisores são alertados via socket para evitar que o cliente fique preso sem resposta.
