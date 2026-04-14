# 🔑 Como Configurar META_APP_SECRET para Webhooks

## ⚠️ Problema Identificado

```
[Webhook] FATAL: META_APP_SECRET não configurado!
[Webhook] Webhooks requerem assinatura HMAC para segurança.
[Webhook] Configure META_APP_SECRET no .env imediatamente.
```

A variável `META_APP_SECRET` é **obrigatória** para validar webhooks do WhatsApp com segurança usando assinatura HMAC.

---

## 🎯 Como Obter o META_APP_SECRET

### **Passo 1: Acessar Dashboard do Meta**

1. Vá para: https://developers.facebook.com/apps/
2. Na lista de apps, clique no seu app do WhatsApp
3. No menu esquerdo, clique em **Settings** → **Basic**

### **Passo 2: Copiar o App Secret**

Na seção "Basic Settings", você verá:

```
┌─────────────────────────────────────────────────────────┐
│  App ID: 123456789                                      │
│  App Secret: abc123def456ghi789jkl012mno345...          │
│  [Show] [Copy]                                          │
└─────────────────────────────────────────────────────────┘
```

Clique no botão **[Show]** (ou **[Copy]**) para revelar/copiar o App Secret.

### **Passo 3: Configurar no .env**

Abra o arquivo `.env` na raiz do projeto e adicione/atualize:

```bash
# Meta App Secret (obtido em Dashboard → Settings → Basic)
META_APP_SECRET=abc123def456ghi789jkl012mno345pqr678stu901vwx234
```

---

## 🔒 Validação de Webhook HMAC

### Como Funciona

1. **Meta envia webhook com header X-Hub-Signature-256**:

   ```
   X-Hub-Signature-256: sha256=HMAC_HASH_AQUI
   ```

2. **Seu servidor valida**:

   ```javascript
   // Seu servidor recalcula o HMAC usando META_APP_SECRET
   const hash = crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex');

   // Compara com o que Meta enviou
   if (`sha256=${hash}` === xHubSignature) {
     // ✅ Webhook é legítimo
   } else {
     // ❌ Webhook rejeitado (pode ser falsificação)
   }
   ```

### Por que é importante?

- ✅ Garante que webhook veio **realmente** de Meta
- ✅ Previne **requisições falsificadas** de atacantes
- ✅ Protege sua aplicação contra **MITM attacks**
- ✅ É **obrigatório** em produção

---

## 📋 Checklist de Configuração

- [ ] Acessou https://developers.facebook.com/apps/
- [ ] Encontrou o App Secret em Settings → Basic
- [ ] Copió o valor completo do App Secret
- [ ] Adicionou/atualizou META_APP_SECRET no `.env`
- [ ] Salvou o arquivo `.env`
- [ ] Reiniciou o servidor (`npm start`)
- [ ] Testou webhook: `[Webhook] HMAC validation: ✅ SUCCESS`

---

## 🧪 Testar a Configuração

### Opção 1: Verificar Logs

Após configurar e reiniciar o servidor, verifique os logs:

```bash
[Webhook] HMAC validation: ✅ SUCCESS
[Webhook] Processing webhook...
POST /webhook 200 OK
```

### Opção 2: Testar com cURL

```bash
# Obter webhook do Meta
curl -X GET http://localhost:3001/webhook \
  -H "X-Hub-Signature-256: sha256=seu_hmac_aqui" \
  -H "X-Hub-Signature: sha1=seu_hmac_sha1_aqui"

# Se retornar 403, META_APP_SECRET está incorreto
# Se retornar 200, está configurado corretamente
```

---

## 🛠️ Troubleshooting

### **Erro: "HMAC validation failed"**

```
[ERROR] HMAC validation failed. Rejecting webhook for security.
```

**Solução**:

- Verifique se `META_APP_SECRET` está correto (sem espaços extras)
- Certifique-se de que é a versão **atual** do App Secret
- Se alterou no dashboard, reinicie o servidor para recarregar `.env`

### **Erro: "META_APP_SECRET não configurado"**

```
[FATAL] META_APP_SECRET não configurado!
```

**Solução**:

- Adicione `META_APP_SECRET=seu_valor` no `.env`
- Execute `npm start` para recarregar
- Verifique que não tem espaços ou caracteres especiais extras

### **Webhook retorna 403 Forbidden**

```
POST /webhook 403 Forbidden
```

**Causas**:

1. `META_APP_SECRET` não configurado ❌
2. `VERIFY_TOKEN` não coincide com do Meta ❌
3. HMAC inválido ❌

**Solução**:

- Verifique ambas as variáveis
- Teste manualmente com cURL

---

## 📚 Referências

- [Meta Webhook Documentation](https://developers.facebook.com/docs/whatsapp/webhooks/get-started)
- [HMAC Validation](https://developers.facebook.com/docs/whatsapp/webhooks/verify-webhooks)
- [Getting App Secret](https://developers.facebook.com/docs/apps/basic-setup#app-dashboard)

---

## 🚀 Próxima Ação

1. **Configure agora**: Obtenha seu `META_APP_SECRET` e atualize o `.env`
2. **Reinicie o servidor**: `npm start`
3. **Valide**: Verifique se webhooks passam na validação HMAC

Após configurar, seu servidor aceitará webhooks do WhatsApp com segurança total! ✅

---

**⚡ Dica Pro**: Use `.env.example` ou `.env.backup` com placeholders como referência, e nunca commita credenciais reais no git.
