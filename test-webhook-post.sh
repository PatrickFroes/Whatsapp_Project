#!/bin/bash
# Script para testar webhook POST com HMAC válido

APP_SECRET="5f15f81a7f3a8d4eb53a01920d60b959"

PAYLOAD='{"object":"whatsapp_business_account","entry":[{"id":"100000000","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"5511999999999","phone_number_id":"946528235219456"},"messages":[{"from":"5511999999999","id":"wamid.test'$(date +%s)'","timestamp":"'$(date +%s)'","type":"text","text":{"body":"Teste webhook POST - '$(date +%H:%M:%S)'"}}]},"field":"messages"}]}]}'

SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$APP_SECRET" -hex | cut -d' ' -f2)"

echo "🧪 Enviando webhook POST com HMAC válido..."
echo "Signature: $SIGNATURE"
echo ""

curl -X POST https://broker.amber.com.br/webhook \
  -H "x-hub-signature-256: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -v 2>&1 | grep -E "HTTP|Webhook|Error|signature|< "
