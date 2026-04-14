#!/bin/bash
# Extract diagnostic info from running Docker container

echo "╔════════════════════════════════════════════╗"
echo "║   WEBHOOK DIAGNOSTIC DATA EXTRACTOR        ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Try to extract Configuration data
echo "1️⃣  Extracting metaAppSecret..."
docker exec broker_app sqlite3 /app/prisma/dev.db -json "SELECT id, tenantId, phoneNumberId, metaAppSecret FROM Configuration LIMIT 1" 2>/dev/null || \
docker exec broker_app psql -U postgres -d broker_db -t -c "SELECT tenantId, phoneNumberId, metaAppSecret FROM \"Configuration\" LIMIT 1" 2>/dev/null || \
echo "Could not access database via container"

echo ""
echo "2️⃣  Checking recent Docker logs for webhooks..."
docker logs broker_app --tail 100 2>/dev/null | grep -i "webhook\|946528\|phone_number_id" | head -20

echo ""
echo "3️⃣  Checking nginx logs..."
docker logs broker_nginx --tail 50 2>/dev/null | grep -i webhook | head -10

echo ""
echo "Done. Use the extracted values with test-webhook-diagnostic.js"
