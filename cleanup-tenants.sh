#!/bin/bash

# Script para deletar tenants obsoletos mantendo apenas admin e TesteEmpresa

echo "╔═══════════════════════════════════════════╗"
echo "║   DELETING OBSOLETE TENANTS               ║"
echo "║   Keeping: admin, TesteEmpresa            ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# Conectar ao banco e listar tenants antes
echo "📋 TENANTS BEFORE DELETE:"
docker exec broker_postgres psql -U postgres -d broker_db -c \
  "SELECT id, name, waPhoneId FROM \"Tenant\" ORDER BY \"createdAt\" DESC;" 

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get IDs to keep
ADMIN_ID=$(docker exec broker_postgres psql -U postgres -d broker_db -t -c \
  "SELECT id FROM \"Tenant\" WHERE name = 'admin' LIMIT 1;" | xargs)

TESTEEMPRESA_ID=$(docker exec broker_postgres psql -U postgres -d broker_db -t -c \
  "SELECT id FROM \"Tenant\" WHERE name = 'TesteEmpresa' LIMIT 1;" | xargs)

echo "✓ Admin ID: $ADMIN_ID"
echo "✓ TesteEmpresa ID: $TESTEEMPRESA_ID"
echo ""

if [ -z "$ADMIN_ID" ] || [ -z "$TESTEEMPRESA_ID" ]; then
  echo "❌ ERROR: Could not find admin or TesteEmpresa"
  exit 1
fi

# Delete all other tenants (cascade deletes related records)
echo "🗑️  DELETING OTHER TENANTS..."
docker exec broker_postgres psql -U postgres -d broker_db -c \
  "DELETE FROM \"Tenant\" WHERE id NOT IN ('$ADMIN_ID', '$TESTEEMPRESA_ID');"

echo ""
echo "✅ DELETE COMPLETE"
echo ""

# Show tenants after
echo "📋 TENANTS AFTER DELETE:"
docker exec broker_postgres psql -U postgres -d broker_db -c \
  "SELECT id, name, waPhoneId FROM \"Tenant\" ORDER BY \"createdAt\" DESC;"

echo ""
echo "✅ Cleanup successful!"
