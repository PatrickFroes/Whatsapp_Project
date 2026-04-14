#!/bin/bash
# Script para verificar se mensagem foi salva

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}📋 Verificando se mensagem foi salva...${NC}\n"

# Executar comando via ssh
ssh amberfy-test@172.233.26.198 << 'REMOTE_CMD'
docker cp /tmp/check.js broker_app:/tmp/check.js 2>/dev/null
docker exec broker_app node /tmp/check.js
REMOTE_CMD
