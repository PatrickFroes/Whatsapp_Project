# 🔍 Webhook Debugging Guide

## Problem
Webhook payload arrives from Meta, but no messages are being processed. Need to identify where in the pipeline it's failing.

## Solution - Enhanced Logging

### Files Modified
1. **webhookHmac.middleware.js** - Added detailed HMAC validation logs
2. **webhookRoutes.js** - Added route entry/exit logs
3. Both now print debug info with 🔍 emoji prefix

### What the Logs Will Show

The new debug logs will reveal:
- ✅ When webhook request arrives (`[Webhook Route]`)
- ✅ When it enters GET or POST handler
- ✅ When rate limiter processes it
- ✅ phone_number_id extraction
- ✅ Tenant lookup status
- ✅ Configuration data
- ✅ HMAC calculation details
- ✅ Signature validation result

## Steps to Test

### 1. Deploy Changes
```bash
ssh amberfy-test@172.233.26.198
cd /home/amberfy-test/broker
git add src/middleware/webhookHmac.middleware.js src/routes/webhookRoutes.js
git commit -m "Add webhook debugging logs"
docker-compose down
docker-compose up -d
docker logs -f broker_app  # Follow logs
```

### 2. Trigger Webhook Again
Option A: Send test message to TesteEmpresa on WhatsApp
- Message will arrive at Meta webhook URL
- Should appear in logs within 2-3 seconds

Option B: If you don't have active WhatsApp message
- Use Meta webhook testing tool in Meta Business Suite
- Or curl from local machine if you have shell access

### 3. Collect Logs
```bash
# Full last 200 lines
docker logs broker_app --tail 200

# Filter for webhook entries
docker logs broker_app --tail 300 | grep -i "webhook\|🔍"

# Save to file for analysis
docker logs broker_app --tail 500 > webhook_logs.txt
```

### 4. Expected Log Sequences

#### Success Path (logs like this):
```
[Webhook Route] POST request received at 2026-04-07T10:30:45Z
[Webhook POST] Event received, passing to webhookLimiter
[Webhook POST] Passed rate limiter, validating HMAC
[Webhook HMAC 🔍] New webhook request detected
[Webhook HMAC 🔍] URL: /webhook
[Webhook HMAC 🔍] Signature header found: sha256=8f36bbd6...
[Webhook HMAC 🔍] Raw body size: 442 bytes
[Webhook HMAC 🔍] Extracted waPhoneId: 946528235219456
[Webhook HMAC 🔍] Full payload object: whatsapp_business_account
[Webhook HMAC 🔍] Entry count: 1
[Webhook HMAC 🔍] Message count: 1
[Webhook HMAC 🔍] ✓ Found tenant: TesteEmpresa (xxx)
[Webhook HMAC 🔍] ✓ Found Configuration
[Webhook HMAC 🔍] phoneNumberId: 946528235219456
[Webhook HMAC 🔍] metaAppSecret: SET ✓
[Webhook HMAC 🔍] Calculating HMAC...
[Webhook HMAC 🔍] Expected signature: sha256=XXXXX...
[Webhook HMAC 🔍] Received signature: sha256=XXXXX...
[Webhook HMAC] ✅ PASSED: Valid webhook from tenant: TesteEmpresa
[Webhook] Subscription verified...
[Webhook] New conversation created...
[Webhook] Message saved...
```

#### Failure Path 1 - No telegram received:
```
(no logs at all for 3+ minutes)
```
**Cause**: Webhook not reaching container (network/DNS/nginx issue)
**Action**: Check nginx proxy, firewall

#### Failure Path 2 - waPhoneId not found:
```
[Webhook HMAC 🔍] Extracted waPhoneId: 946528235219456
[Webhook HMAC] ❌ No tenant found for waPhoneId: 946528235219456
[Webhook HMAC] Available tenants: [...]
```
**Cause**: Tenant.waPhoneId not synced
**Action**: Manually sync or check Configuration sync logic

#### Failure Path 3 - HMAC signature invalid:
```
[Webhook HMAC 🔍] Expected signature: sha256=AAAAA...
[Webhook HMAC 🔍] Received signature: sha256=BBBBB...
[Webhook HMAC] ❌ Invalid signature for tenant TesteEmpresa
```
**Cause**: metaAppSecret mismatch, body modified, or JSON serialization differences
**Action**: Verify metaAppSecret from Meta Dashboard

#### Failure Path 4 - No Configuration:
```
[Webhook HMAC 🔍] ✓ Found tenant: TesteEmpresa
[Webhook HMAC 🔍] ❌ No Configuration found for tenant xxx
```
**Cause**: Configuration record doesn't exist
**Action**: Create Configuration via admin panel

## Advanced Debugging

### Get metaAppSecret Value
```bash
ssh amberfy-test@172.233.26.198
docker exec broker_app psql -U postgres -d broker_db -c \
  "SELECT \"tenantId\", \"phoneNumberId\", \"metaAppSecret\" FROM \"Configuration\";"
```

### Test HMAC Locally
1. Get the X-Hub-Signature-256 value from logs
2. Get metaAppSecret from database
3. Get full webhook JSON from docker logs
4. Run:
```bash
node test-webhook-diagnostic.js
export META_APP_SECRET="value_from_database"
export X_HUB_SIGNATURE="sha256=value_from_logs"
node test-webhook-diagnostic.js
```

### Manual Webhook Test
```bash
# From your local machine
curl -X POST https://172.233.26.198/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=XXXXXXXXX" \
  -d '{"object":"whatsapp_business_account",...}'
```

## Checklist Before Your Next Test

- [ ] Deploy modified files to server
- [ ] Restart Docker containers
- [ ] Confirm logs are showing with new debug format
- [ ] Send/trigger a test webhook
- [ ] Collect logs within 5 minutes of webhook arrival
- [ ] Check for [Webhook HMAC 🔍] log entries
- [ ] Share logs with analysis team

## After Logs Are Captured

1. Share complete docker logs (last 500 lines)
2. Include exact time when webhook was sent
3. Include full error message if any

This will pinpoint EXACTLY where webhook processing fails.
