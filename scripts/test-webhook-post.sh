#!/bin/bash
# Script para testar webhook POST com HMAC válido

APP_SECRET="SEU_APP_SECRET_DE_TESTE"

PAYLOAD='{"object":"whatsapp_business_account","entry":[{"id":"100000000","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"5511999999999","phone_number_id":"123456789012345"},"messages":[{"from":"5511999999999","id":"wamid.test'$(date +%s)'","timestamp":"'$(date +%s)'","type":"text","text":{"body":"Teste webhook POST - '$(date +%H:%M:%S)'"}}]},"field":"messages"}]}]}'

SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$APP_SECRET" -hex | cut -d' ' -f2)"

echo "🧪 Enviando webhook POST com HMAC válido..."
echo "Signature: $SIGNATURE"
echo ""

curl -X POST https://localhost:3001/webhook \
  -H "x-hub-signature-256: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -v 2>&1 | grep -E "HTTP|Webhook|Error|signature|< "
