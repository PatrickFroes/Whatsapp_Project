#!/bin/bash

# Script para gerar certificado SSL com Let's Encrypt via Certbot
# Execute este script no servidor antes de iniciar docker-compose

DOMAIN="dev-saas.amber.com.br"
EMAIL="seu-email@amber.com.br"  # ALTERE PARA SEU EMAIL

# Criar diretórios necessários
mkdir -p certs
mkdir -p certbot

# Instalar Certbot (se não estiver instalado)
if ! command -v certbot &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y certbot python3-certbot-dns-route53
fi

# Gerar certificado
echo "Gerando certificado SSL para $DOMAIN..."
sudo certbot certonly \
    --standalone \
    --agree-tos \
    --no-eff-email \
    --email $EMAIL \
    -d $DOMAIN

# Copiar certificados para a pasta local
sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem certs/
sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem certs/

# Ajustar permissões
sudo chown -R $USER:$USER certs/

echo "✅ Certificado gerado com sucesso!"
echo "Certificados armazenados em: ./certs/"
