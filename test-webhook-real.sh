#!/bin/bash

# Script para testar webhook com payload real

PAYLOAD=$(cat << 'EOFPAYLOAD'
{"object":"whatsapp_business_account","entry":[{"id":"2169447660256643","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15551455475","phone_number_id":"946528235219456"},"contacts":[{"profile":{"name":"Patrick"},"wa_id":"554198613849","country_code":"BR"}],"messages":[{"from":"554198613849","id":"wamid.HBgMNTU0MTk4NjEzODQ5FQIAEhggQUM2MjdCOTVENzk3MTEwOTY1RDFEREYyMkRDNjU3M0MA","timestamp":"1775581635","text":{"body":"Oi"},"from_logical_id":"146084789796904","type":"text"}]},"field":"messages"}]}]}
EOFPAYLOAD
)

echo "==== WEBHOOK TEST SCRIPT ===="
echo ""
echo "1. Extracting metaAppSecret from database..."

# Extract metaAppSecret
SECRET=$(docker exec broker_postgres psql -U postgres -d broker_db -t -c \
  "SELECT \"metaAppSecret\" FROM \"Configuration\" WHERE tenantId IN (SELECT id FROM \"Tenant\" WHERE waPhoneId = '946528235219456') LIMIT 1 2>/dev/null" | xargs)

if [ -z "$SECRET" ]; then
  echo "❌ Could not extract metaAppSecret"
  echo "Making sure database is accessible..."
  docker exec broker_postgres psql -U postgres -d broker_db -c "SELECT count(*) FROM \"Configuration\";"
  exit 1
fi

echo "✓ Got metaAppSecret: ${SECRET:0:20}..."
echo ""

echo "2. Calculating HMAC signature..."
SIGNATURE=$(docker exec broker_app node -e "
const crypto = require('crypto');
const secret = process.argv[1];
const payload = process.argv[2];
const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log('sha256=' + hmac);
" -- "$SECRET" "$PAYLOAD")

echo "✓ Signature: ${SIGNATURE:0:30}..."
echo ""

echo "3. Sending webhook POST request..."
echo "   URL: http://localhost:3001/webhook"
echo "   Phone ID: 946528235219456"
echo ""

# Send webhook
docker exec broker_app curl -X POST "http://localhost:3001/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -d "$PAYLOAD" \
  -w "\nHTTP Status: %{http_code}\n" \
  2>/dev/null

echo ""
echo "4. Waiting 2 seconds for processing..."
sleep 2

echo ""
echo "5. Capturing webhook logs..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker logs broker_app --tail 200 | grep -E "Webhook|🔍|HMAC|Message|Contact|Conversation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "6. Checking if message was saved..."
docker exec broker_postgres psql -U postgres -d broker_db -c \
  "SELECT id, waId, content, createdAt FROM \"Message\" WHERE waId LIKE '%HBgMNTU0MTk4NjEzODQ5%' LIMIT 1;"

echo ""
echo "✅ Test complete!"
