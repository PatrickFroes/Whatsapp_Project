# 📚 Documentação - WhatsApp Broker

Bem-vindo à documentação do sistema WhatsApp Broker (CPaaS Multi-Tenant).

## 📖 Índice

### FlowEngine (Bot/URA)

- **[FLOW_ENGINE_GUIDE.md](FLOW_ENGINE_GUIDE.md)** - Guia completo de configuração e uso

### Exemplos de Flows

- **[flow_example_simple.json](flow_example_simple.json)** - Flow básico para testes
- **[flow_example_demo_complete.json](flow_example_demo_complete.json)** - Flow completo demonstrativo

---

## 🚀 Quick Start - FlowEngine

### 1. Estrutura Básica de um Flow

```json
{
  "start": {
    "type": "text",
    "message": "Olá {{name}}!",
    "next": "menu"
  },
  "menu": {
    "type": "menu",
    "message": "Como posso ajudar?",
    "options": {
      "Vendas": "vendas",
      "Suporte": "suporte"
    }
  },
  "vendas": {
    "type": "transfer_agent",
    "message": "Transferindo para vendas...",
    "skill": "Vendas"
  }
}
```

### 2. Configurar no Tenant

```javascript
// No banco de dados (tenant.flows)
{
  "active": "Padrão",
  "uras": {
    "Padrão": {
      "start": { /* flow aqui */ }
    }
  }
}
```

### 3. Testar

Envie uma mensagem para o número do tenant via WhatsApp e o bot responderá automaticamente.

---

## 🔍 Tipos de Nós Disponíveis

| Tipo               | Descrição                   | Uso                     |
| ------------------ | --------------------------- | ----------------------- |
| **text**           | Mensagem simples            | Exibir informação       |
| **menu**           | Menu interativo             | Opções para usuário     |
| **collect_data**   | Coletar input com validação | Pedir CPF, e-mail, nome |
| **conditional**    | If/else baseado em dados    | Decisões lógicas        |
| **api_call**       | Chamar API externa          | Consultar CEP, status   |
| **set_data**       | Definir variável            | Controle de fluxo       |
| **transfer_agent** | Transferir para agente      | Atendimento humano      |
| **transfer_queue** | Enviar para fila            | Enfileirar conversa     |
| **end**            | Finalizar flow              | Encerramento            |

---

## 📊 Recursos do FlowEngine V2

### ✅ Coleta de Dados com Validação

```json
{
  "pedir_email": {
    "type": "collect_data",
    "message": "Qual seu e-mail?",
    "data_key": "email",
    "validation_pattern": "^[\\w.-]+@[\\w.-]+\\.[a-z]{2,}$",
    "validation_error": "E-mail inválido!",
    "next": "proximo"
  }
}
```

### ✅ Lógica Condicional

```json
{
  "check_idade": {
    "type": "conditional",
    "condition": "{{idade}} >= 18",
    "if_true": "maior",
    "if_false": "menor"
  }
}
```

### ✅ Chamadas API

```json
{
  "consultar_cep": {
    "type": "api_call",
    "api_url": "https://viacep.com.br/ws/{{cep}}/json/",
    "api_save_var": "endereco",
    "api_map_fields": {
      "cidade": "localidade",
      "uf": "uf"
    },
    "next": "mostrar_endereco"
  }
}
```

### ✅ Horário Comercial

```json
{
  "businessHours": {
    "enabled": true,
    "timezone": "America/Sao_Paulo",
    "hours": {
      "monday": { "open": "09:00", "close": "18:00" }
    },
    "autoReplyEnabled": true,
    "autoReplyMessage": "Fora do horário!"
  }
}
```

---

## 🎯 Casos de Uso Comuns

### 1. **SAC Automatizado**

- Menu de opções (vendas, suporte, financeiro)
- Coleta de dados do cliente
- Transferência para skill específica

### 2. **Cadastro de Leads**

- Coleta: nome, e-mail, telefone
- Validação de formato
- Envio para CRM via API

### 3. **Rastreamento de Pedidos**

- Coleta número do pedido
- Consulta API de tracking
- Exibe status e previsão

### 4. **Consulta de CEP/Frete**

- Coleta CEP
- Consulta ViaCEP
- Calcula frete baseado na região

### 5. **Atendimento Horário Comercial**

- Verifica horário
- Se fechado: mensagem + enfileira
- Se aberto: processa flow normal

---

## 🔧 Manutenção e Debug

### Verificar Estado da Conversa

```sql
SELECT flowState FROM conversations WHERE id = ?;
```

### Logs do FlowEngine

```bash
# No console do Node.js
[FlowEngine] Executando nó: menu_principal (tipo: menu)
[FlowEngine] Processando input. Esperando: menu, Input: vendas
[FlowEngine] Atribuído para João Silva
```

### Reiniciar Flow

```javascript
// Resetar flowState para recomeçar
await prisma.conversation.update({
  where: { id: conversationId },
  data: {
    flowState: {
      nodeId: 'start',
      step: 0,
      data: {},
      history: []
    }
  }
});
```

---

## 📈 Métricas e Monitoramento

### KPIs Importantes

- **Taxa de conclusão do flow** (chegaram no end)
- **Taxa de transferência para agente** (abandono do bot)
- **Tempo médio no bot** (antes de transferir)
- **Erros de validação** (inputs inválidos)
- **Chamadas API com falha**

### Onde Monitorar

- **Logs**: Console do Node.js (`[FlowEngine]`)
- **Banco**: `flowState.history` em conversations
- **Mensagens**: Tabela `messages` (direction: OUTBOUND, senderId: null)

---

## 🛠️ Troubleshooting

### Bot não responde

1. **Verificar**: `conversation.status === 'BOT'`
2. **Verificar**: `tenant.flows.active` existe
3. **Verificar**: Flow tem nó `start`
4. **Verificar**: Logs de erro no console

### Validação sempre falha

1. **Verificar**: Regex do `validation_pattern`
2. **Testar** regex em [regex101.com](https://regex101.com)
3. **Verificar**: Input do usuário (espaços extras?)

### API call não funciona

1. **Verificar**: URL está correta
2. **Verificar**: Timeout 10s é suficiente
3. **Verificar**: Headers de autenticação
4. **Usar**: `on_error_message` para debug

### Loop infinito

- **Causa**: Nós formam ciclo sem saída
- **Proteção**: MAX_FLOW_STEPS = 15
- **Solução**: Após 15 steps, transfere automaticamente

### Transferência não funciona

1. **Verificar**: Agente está ONLINE
2. **Verificar**: Skill existe e está associada
3. **Verificar**: Agente não atingiu `maxChats`
4. **Fallback**: Enfileira automaticamente se nenhum disponível

---

## 📞 Suporte

Para dúvidas ou problemas:

1. Consulte [FLOW_ENGINE_GUIDE.md](FLOW_ENGINE_GUIDE.md) (guia completo)
2. Veja exemplos em `docs/flow_example_*.json`
3. Analise logs com `[FlowEngine]`

---

## 🔗 Links Úteis

- **Prisma Schema**: [../prisma/schema.prisma](../prisma/schema.prisma)
- **WebhookController**: [../src/controllers/WebhookController.js](../src/controllers/WebhookController.js)
- **FlowEngine**: [../src/services/FlowEngine.js](../src/services/FlowEngine.js)
- **WhatsApp Service**: [../src/services/whatsapp.js](../src/services/whatsapp.js)

---

**Versão:** 2.0  
**Última Atualização:** 2026-01-XX  
**Desenvolvido por:** ShoppingTech
