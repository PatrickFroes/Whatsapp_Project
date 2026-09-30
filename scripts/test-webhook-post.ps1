\$APP_SECRET = 'SEU_APP_SECRET_DE_TESTE'
\$timestamp = [DateTimeOffset]::Now.ToUnixTimeSeconds()

\$payload = @{
    object = 'whatsapp_business_account'
    entry = @(@{
        id = '100000000'
        changes = @(@{
            value = @{
                messaging_product = 'whatsapp'
                metadata = @{
                    display_phone_number = '5511999999999'
                    phone_number_id = '123456789012345'
                }
                messages = @(@{
                    from = '5511999999999'
                    id = "wamid.test$(\$timestamp)"
                    timestamp = \$timestamp
                    type = 'text'
                    text = @{ body = "Teste webhook POST - $(Get-Date -Format 'HH:mm:ss')" }
                })
            }
            field = 'messages'
        })
    })
} | ConvertTo-Json -Depth 10

\$bytes = [System.Text.Encoding]::UTF8.GetBytes(\$payload)
\$hmac = New-Object System.Security.Cryptography.HMACSHA256
\$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes(\$APP_SECRET)
\$hash = \$hmac.ComputeHash(\$bytes)
\$signature = 'sha256=' + ([System.BitConverter]::ToString(\$hash).Replace('-','').ToLower())

Write-Host "🧪 Enviando webhook POST com HMAC válido" -ForegroundColor Cyan
Write-Host "Signature: \$signature" -ForegroundColor Yellow
Write-Host ""

try {
    \$ProgressPreference = 'SilentlyContinue'
    \$response = Invoke-WebRequest -Uri 'https://localhost:3001/webhook' -Method POST -Headers @{'x-hub-signature-256'=\$signature; 'Content-Type'='application/json'} -Body \$payload -SkipCertificateCheck
    
    Write-Host "✅ Status: \$(\$response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: \$(\$response.Content)"
    
} catch {
    Write-Host "❌ Erro: \$(\$_.Exception.Message)" -ForegroundColor Red
    if (\$_.Exception.Response) {
        Write-Host "Status: \$(\$_.Exception.Response.StatusCode.Value)"
        Write-Host "Body: \$(\$_.Exception.Response | ConvertFrom-Json)"
    }
}
