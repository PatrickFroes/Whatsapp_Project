#!/usr/bin/env pwsh

# Enviar arquivo de verificação
Write-Host "📤 Enviando arquivo..." -ForegroundColor Cyan
scp c:\Users\Striker\Documents\Broker\check-message-saved.js amberfy-test@172.233.26.198:/tmp/check.js

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Arquivo enviado com sucesso" -ForegroundColor Green
    
    # Copiar para container e executar
    Write-Host "🐳 Copiando para container e executando..." -ForegroundColor Cyan
    ssh amberfy-test@172.233.26.198 "docker cp /tmp/check.js broker_app:/tmp/check.js && docker exec broker_app node /tmp/check.js"
} else {
    Write-Host "❌ Erro ao enviar arquivo" -ForegroundColor Red
}
