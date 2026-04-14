# FlowEngine V2 - Guia de Configuração

## 📋 Visão Geral

O FlowEngine V2 é um sistema de URA/Chatbot refinado com suporte a:

✅ **Horário comercial** - Mensagem automática fora do expediente  
✅ **Coleta de dados** - Solicita e valida informações do usuário  
✅ **Menus interativos** - Botões/listas do WhatsApp  
✅ **Condicionais** - Lógica if/else baseada em dados  
✅ **Chamadas API** - Integração com sistemas externos  
✅ **Transferências inteligentes** - Por skill ou fila  
✅ **Tratamento de erros** - Fallback para agente humano

---

## 🏗️ Estrutura do Flow

Um flow é um objeto JSON onde cada chave é um **nó** (step):

```json
{
  "start": {
    "type": "text",
    "message": "Olá {{name}}! Bem-vindo.",
    "next": "menu_principal"
  },
  "menu_principal": {
    "type": "menu",
    "message": "Como posso ajudar?",
    "options": {
      "Vendas": "node_vendas",
      "Suporte": "node_suporte",
      "Falar com atendente": "transfer_agente"
    }
  }
}
```

---

## 📦 Tipos de Nós

### 1. **text** - Mensagem simples

Envia texto e avança automaticamente.

```json
{
  "welcome": {
    "type": "text",
    "message": "Olá, {{name}}! Como vai?",
    "next": "pergunta_nome"
  }
}
```

**Campos:**

- `type`: `"text"` ou `"auto"`
- `message`: Texto a enviar (suporta variáveis)
- `next`: ID do próximo nó

---

### 2. **menu** - Menu interativo

Exibe opções para o usuário escolher.

```json
{
  "menu_atendimento": {
    "type": "menu",
    "message": "Escolha uma opção:",
    "header": "Central de Atendimento",
    "footer": "Selecione abaixo",
    "options": {
      "Vendas": "node_vendas",
      "Suporte Técnico": "node_suporte",
      "Financeiro": "node_financeiro"
    }
  }
}
```

**Campos:**

- `type`: `"menu"`
- `message`: Texto do menu
- `header`: Cabeçalho (opcional, usado em listas)
- `footer`: Rodapé (opcional)
- `options`: Objeto `{ "Texto opção": "id_próximo_nó" }`

**Comportamento:**

- ≤ 3 opções curtas → Botões interativos
- 4-10 opções → Lista interativa
- \> 10 opções → Texto numerado

**Matching:**

1. Exato: "Vendas" → vendas
2. Por número: "1" → primeira opção
3. Parcial: "vend" → Vendas

---

### 3. **collect_data** - Coleta informação

Solicita input do usuário e salva em variável.

```json
{
  "pedir_nome": {
    "type": "collect_data",
    "message": "Qual seu nome completo?",
    "data_key": "nome_cliente",
    "validation_pattern": "^[A-Za-zÀ-ÿ\\s]{3,}$",
    "validation_error": "❌ Nome inválido. Por favor, use apenas letras.",
    "next": "pedir_email"
  },
  "pedir_email": {
    "type": "collect_data",
    "message": "Agora me informe seu e-mail:",
    "data_key": "email",
    "validation_pattern": "^[\\w.-]+@[\\w.-]+\\.[a-z]{2,}$",
    "validation_error": "❌ E-mail inválido. Tente novamente.",
    "next": "confirmar_dados"
  }
}
```

**Campos:**

- `type`: `"collect_data"`
- `message`: Pergunta ao usuário
- `data_key`: Nome da variável onde salvar (acessível via `{{data_key}}`)
- `validation_pattern`: Regex para validar (opcional)
- `validation_error`: Mensagem de erro (opcional)
- `next`: Próximo nó após coleta bem-sucedida

**Variável disponível:**
Após coleta, use `{{nome_cliente}}` nos nós seguintes.

---

### 4. **conditional** - Decisão lógica

Avalia condição e segue caminho if/else.

```json
{
  "check_tipo": {
    "type": "conditional",
    "condition": "{{tipo_cliente}} === 'vip'",
    "if_true": "atendimento_vip",
    "if_false": "atendimento_padrao"
  }
}
```

**Campos:**

- `type`: `"conditional"`
- `condition`: Expressão JavaScript (use variáveis entre `{{}}`)
- `if_true`: Nó se condição for verdadeira
- `if_false`: Nó se condição for falsa (opcional, usa `next` se não definido)

**Operadores permitidos:**
`===`, `!==`, `>`, `<`, `>=`, `<=`, `&&`, `||`

**Exemplos:**

```javascript
'{{idade}} >= 18';
"{{status}} === 'ativo' && {{score}} > 50";
"{{tipo}} !== 'bloqueado'";
```

---

### 5. **api_call** - Chamada HTTP

Faz requisição HTTP e salva resposta.

```json
{
  "consultar_cep": {
    "type": "api_call",
    "api_url": "https://viacep.com.br/ws/{{cep}}/json/",
    "api_method": "GET",
    "api_headers": {
      "Content-Type": "application/json"
    },
    "api_save_var": "endereco",
    "api_map_fields": {
      "cidade": "localidade",
      "uf": "uf",
      "bairro": "bairro"
    },
    "on_error_message": "❌ CEP não encontrado.",
    "on_error_next": "pedir_cep_novamente",
    "next": "confirmar_endereco"
  }
}
```

**Campos:**

- `type`: `"api_call"`
- `api_url`: URL da API (suporta variáveis)
- `api_method`: `GET`, `POST`, `PUT`, `DELETE` (padrão: `GET`)
- `api_headers`: Headers da requisição (opcional)
- `api_body`: JSON do body, em string (opcional, usar com POST/PUT)
- `api_save_var`: Nome da variável para salvar resposta completa
- `api_map_fields`: Mapear campos específicos da resposta
- `on_error_message`: Mensagem se API falhar (opcional)
- `on_error_next`: Nó de fallback em caso de erro (opcional)
- `next`: Próximo nó em caso de sucesso

**Timeout:** 10 segundos

**Acesso à resposta:**

- Completa: `{{endereco}}`
- Campo específico: `{{cidade}}` (se mapeado em `api_map_fields`)

---

### 6. **set_data** - Define variável

Define valor para variável manualmente.

```json
{
  "marcar_vip": {
    "type": "set_data",
    "data_key": "tipo_cliente",
    "data_value": "vip",
    "next": "atendimento_vip"
  }
}
```

**Campos:**

- `type`: `"set_data"`
- `data_key`: Nome da variável
- `data_value`: Valor (suporta interpolação com outras variáveis)
- `next`: Próximo nó

---

### 7. **transfer_agent** - Transferir para agente

Transfere conversa para agente humano com skill específica.

```json
{
  "transferir_vendas": {
    "type": "transfer_agent",
    "message": "Transferindo para o setor de vendas...",
    "dept": "Vendas",
    "skill": "Vendas"
  }
}
```

**Campos:**

- `type`: `"transfer_agent"` ou `"transfer"`
- `message`: Mensagem antes da transferência (opcional)
- `dept` ou `skill`: Nome da skill (opcional, senão vai para qualquer agente)

**Comportamento:**

1. Busca agentes **ONLINE** com a skill
2. Seleciona o **menos ocupado**
3. Verifica **limite de chats** (`maxChats`)
4. Se nenhum disponível → enfileira automaticamente

---

### 8. **transfer_queue** - Enviar para fila

Envia conversa para fila de espera.

```json
{
  "enfileirar": {
    "type": "transfer_queue",
    "message": "Todos os atendentes estão ocupados. Você está na fila.",
    "dept": "Suporte"
  }
}
```

**Campos:**

- `type`: `"transfer_queue"`
- `message`: Mensagem ao enfileirar (opcional)
- `dept`: Skill preferencial (opcional)

---

### 9. **end** - Finalizar flow

Encerra flow e opcionalmente enfileira.

```json
{
  "despedida": {
    "type": "end",
    "message": "Obrigado pelo contato! Até logo."
  }
}
```

**Campos:**

- `type`: `"end"`
- `message`: Mensagem de despedida (opcional)

**Comportamento:**
Após enviar mensagem, enfileira conversa automaticamente.

---

## 🔤 Variáveis e Interpolação

Use `{{variavel}}` para inserir valores dinâmicos:

### Variáveis automáticas:

- `{{name}}` - Nome do contato
- `{{phone}}` - Telefone do contato

### Variáveis coletadas:

Qualquer `data_key` definido em `collect_data`:

```json
"Por favor, {{nome_cliente}}, confirme seu e-mail: {{email}}"
```

### Variáveis de API:

Salvas em `api_save_var` ou `api_map_fields`:

```json
"Seu endereço é: {{cidade}}, {{uf}}"
```

### Variáveis definidas:

Através de `set_data`:

```json
"Você é cliente {{tipo_cliente}}"
```

---

## ⏰ Horário Comercial

Configure no tenant:

```json
{
  "businessHours": {
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
    "autoReplyMessage": "Estamos fora do horário de atendimento (09h-18h). Retornaremos em breve!"
  }
}
```

**Comportamento:**

- Se fora do horário → envia `autoReplyMessage` e enfileira
- Conversa fica com status `QUEUED` até próximo horário
- `flowState.waitingForBusiness = true`

---

## 📝 Exemplo Completo: Cadastro + API + Transferência

```json
{
  "start": {
    "type": "text",
    "message": "Olá {{name}}! Bem-vindo à nossa loja.",
    "next": "menu_principal"
  },

  "menu_principal": {
    "type": "menu",
    "message": "O que deseja fazer?",
    "options": {
      "Fazer Pedido": "pedir_cep",
      "Rastrear Pedido": "rastrear",
      "Falar com Atendente": "transferir_agente"
    }
  },

  "pedir_cep": {
    "type": "collect_data",
    "message": "Para calcular o frete, informe seu CEP (apenas números):",
    "data_key": "cep",
    "validation_pattern": "^\\d{8}$",
    "validation_error": "❌ CEP inválido. Digite 8 números sem traço.",
    "next": "consultar_cep"
  },

  "consultar_cep": {
    "type": "api_call",
    "api_url": "https://viacep.com.br/ws/{{cep}}/json/",
    "api_method": "GET",
    "api_save_var": "endereco",
    "api_map_fields": {
      "cidade": "localidade",
      "uf": "uf"
    },
    "on_error_message": "❌ CEP não encontrado. Vou transferir para um atendente.",
    "on_error_next": "transferir_agente",
    "next": "confirmar_endereco"
  },

  "confirmar_endereco": {
    "type": "text",
    "message": "Certo! Você está em {{cidade}}-{{uf}}. Prosseguindo com o pedido...",
    "next": "check_valor"
  },

  "check_valor": {
    "type": "conditional",
    "condition": "{{uf}} === 'SP'",
    "if_true": "oferta_sp",
    "if_false": "oferta_geral"
  },

  "oferta_sp": {
    "type": "text",
    "message": "🎉 Frete GRÁTIS para SP!",
    "next": "transferir_vendas"
  },

  "oferta_geral": {
    "type": "text",
    "message": "Frete calculado: R$ 15,00",
    "next": "transferir_vendas"
  },

  "transferir_vendas": {
    "type": "transfer_agent",
    "message": "Transferindo para vendas finalizar seu pedido...",
    "skill": "Vendas"
  },

  "rastrear": {
    "type": "collect_data",
    "message": "Informe o código de rastreio:",
    "data_key": "codigo_rastreio",
    "next": "consultar_rastreio"
  },

  "consultar_rastreio": {
    "type": "api_call",
    "api_url": "https://api.example.com/tracking/{{codigo_rastreio}}",
    "api_method": "GET",
    "api_headers": {
      "Authorization": "Bearer TOKEN_AQUI"
    },
    "api_save_var": "tracking",
    "api_map_fields": {
      "status_pedido": "status",
      "ultima_atualizacao": "lastUpdate"
    },
    "on_error_message": "Código não encontrado. Transferindo...",
    "on_error_next": "transferir_agente",
    "next": "mostrar_status"
  },

  "mostrar_status": {
    "type": "text",
    "message": "📦 Status: {{status_pedido}}\\nÚltima atualização: {{ultima_atualizacao}}",
    "next": "menu_pos_rastreio"
  },

  "menu_pos_rastreio": {
    "type": "menu",
    "message": "Posso ajudar em mais algo?",
    "options": {
      "Falar com atendente": "transferir_agente",
      "Encerrar": "fim"
    }
  },

  "transferir_agente": {
    "type": "transfer_agent",
    "message": "Conectando com um atendente humano..."
  },

  "fim": {
    "type": "end",
    "message": "Obrigado! Até logo. 👋"
  }
}
```

---

## 🔍 Testando o Flow

1. **Via API**: Envie mensagem para o webhook
2. **Via WhatsApp**: Envie mensagem para o número configurado
3. **Logs**: Acompanhe no console `[FlowEngine]`

### Debugando:

```javascript
// Estado atual salvo em conversation.flowState:
{
  nodeId: "menu_principal",      // Nó atual
  step: 3,                        // Contador de passos
  data: {                         // Variáveis coletadas
    nome_cliente: "João Silva",
    email: "joao@example.com",
    cep: "01310100"
  },
  waitingFor: "menu_principal",  // Aguardando input de menu
  history: [...]                  // Histórico de navegação
}
```

---

## ⚠️ Limites e Fallbacks

| Limite                 | Valor         | Comportamento                                 |
| ---------------------- | ------------- | --------------------------------------------- |
| **Máximo de steps**    | 15            | Após 15 nós executados, transfere para agente |
| **Timeout API**        | 10s           | Se API demorar, usa `on_error_next`           |
| **Botões interativos** | 3             | Máximo 3 botões WhatsApp                      |
| **Lista interativa**   | 10            | Máximo 10 itens na lista                      |
| **Título botão**       | 20 caracteres | Limite WhatsApp                               |
| **Título lista**       | 24 caracteres | Limite WhatsApp                               |

### Fallbacks automáticos:

- **Sem flow configurado** → Mensagem + transfer_queue
- **Nó não encontrado** → Reinicia no `start`
- **Erro crítico** → Mensagem de erro + transfer_queue
- **Fora do horário** → Auto-reply + enfileira
- **Agente indisponível** → Enfileira automaticamente

---

## 🚀 Migração do FlowEngine Antigo

O **FlowEngine V2** é **100% retrocompatível** com flows antigos.

### Melhorias principais:

✅ **BusinessHours** integrado  
✅ **collect_data** com validação regex  
✅ **conditional** para lógica if/else  
✅ **api_call** com timeout de 10s (era 5s)  
✅ **Tratamento de erros** completo  
✅ **MAX_FLOW_STEPS** aumentado para 15  
✅ **Match fuzzy** melhorado em menus  
✅ **Fallback** automático quando flow inválido

### Breaking changes:

❌ Nenhum! Seus flows continuam funcionando.

---

## 📞 Suporte

- **Logs**: Busque `[FlowEngine]` no console
- **Estado**: `conversation.flowState` no banco
- **Teste**: Use WhatsApp para simular jornada completa

Desenvolvido com ❤️ por ShoppingTech
