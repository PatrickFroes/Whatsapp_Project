# ✅ Multi-Tenant Implementation Checklist

**Status**: In Progress  
**Started**: 2026-03-04  
**Owner**: [Your Name]

---

## 🔴 PHASE 1: Already Completed ✅

### Webhook Security (DONE)

- [x] Create webhookHmac.middleware.js
  - [x] Extract waPhoneId from webhook body
  - [x] Find tenant by waPhoneId
  - [x] Load Configuration from tenant
  - [x] Validate HMAC using metaAppSecret
  - [x] Inject req.tenant and req.webhookConfig
- [x] Update WebhookController.verify()
  - [x] Remove global WEBHOOK_VERIFY_TOKEN validation
  - [x] Respond to challenge only
- [x] Update webhookRoutes.js
  - [x] Import validateWebhookHmac middleware
  - [x] Apply to POST /webhook
- [x] Tests
  - [x] npm run quality passes (13/13) ✅
  - [x] ESLint: 0 errors ✅
  - [x] Prettier: formatted ✅

---

## 🟡 PHASE 2: In Progress (DO THIS NEXT)

### FlowEngine Service Integration (Do This First!)

**File**: `src/services/FlowEngine.js`

**Tasks**:

- [ ] Find function: `static async process(tenant, conversation, message)`
- [ ] After validation, add:

  ```javascript
  // Load configuration for this tenant
  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id }
  });

  if (!config?.whatsappToken) {
    console.error(`FlowEngine: WhatsApp token not configured for tenant ${tenant.id}`);
    return;
  }
  ```

- [ ] Find all instances of `process.env.WHATSAPP_TOKEN`
  - Replace with `config.whatsappToken`
- [ ] Find all instances of phone number ID (in API calls)
  - Replace with `config.phoneNumberId`
- [ ] Test: Send message from 2 different tenants
  - Verify each uses their own token

**Time**: 30 minutes

---

### MediaService Integration (Second!)

**File**: `src/services/MediaService.js`

**Tasks**:

- [ ] Add `tenantId` parameter to functions:
  - [ ] `downloadMedia(tenantId, ...)`
  - [ ] `uploadMedia(tenantId, ...)`
  - [ ] Any other API calls
- [ ] In each function, add:

  ```javascript
  const config = await prisma.configuration.findUnique({
    where: { tenantId }
  });

  if (!config?.whatsappToken) {
    throw new Error(`WhatsApp token not configured for tenant: ${tenantId}`);
  }
  ```

- [ ] Replace `process.env` tokens with config values
  - `Bearer ${config.whatsappToken}`
  - `${config.phoneNumberId}/media`
- [ ] Update callers of MediaService
  - Pass tenantId when calling these functions

**Time**: 30 minutes

---

### QueueService Validation (Third!)

**File**: `src/services/QueueService.js`

**Tasks**:

- [ ] Add `tenantId` parameter to functions
- [ ] Before any UPDATE: validate target belongs to tenant

  ```javascript
  // Validate conversation belongs to tenant
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId }
  });
  if (conversation.tenantId !== tenantId) {
    throw new Error('Conversation does not belong to this tenant');
  }

  // Validate agent belongs to tenant
  const agent = await prisma.user.findUnique({
    where: { id: agentId }
  });
  if (agent.tenantId !== tenantId) {
    throw new Error('Agent does not belong to this tenant');
  }
  ```

**Time**: 20 minutes

---

## 🟢 PHASE 3: Testing & Validation

### Integration Tests (1-2 hours)

**Setup**:

- [ ] Create 2 test tenants with different configs

  ```javascript
  const t1 = await prisma.tenant.create({
    data: { name: 'Tenant Test 1', waPhoneId: '111' }
  });
  const t2 = await prisma.tenant.create({
    data: { name: 'Tenant Test 2', waPhoneId: '222' }
  });

  await prisma.configuration.create({
    data: { tenantId: t1.id, whatsappToken: 'token_test_1', ... }
  });
  await prisma.configuration.create({
    data: { tenantId: t2.id, whatsappToken: 'token_test_2', ... }
  });
  ```

**Webhook Tests**:

- [ ] Send webhook from Tenant 1
  - Verify HMAC validated ✅
  - Verify uses token_test_1
  - Verify creates conversation for Tenant 1
- [ ] Send webhook from Tenant 2
  - Verify HMAC validated ✅
  - Verify uses token_test_2
  - Verify creates conversation for Tenant 2 (separate from T1)
- [ ] Send forged webhook (bad HMAC)
  - Verify rejected (403) ✅

**Message Tests**:

- [ ] Send message from Agent T1
  - Verify uses token_test_1 ✅
  - Verify agent cannot see T2 conversations
- [ ] Send message from Agent T2
  - Verify uses token_test_2 ✅
  - Verify agent cannot see T1 conversations

**Security Tests**:

- [ ] Try webhook for T1 with token_test_2
  - Should fail HMAC validation ✅
- [ ] Try assigning T2 conversation to T1 agent
  - Should reject (tenantId mismatch) ✅

---

### Code Quality & Formatting

- [ ] Run: `npm run lint`
  - Fix errors (if any from changes)
- [ ] Run: `npm run format`
  - Apply Prettier formatting
- [ ] Run: `npm run quality`
  - All tests pass
  - 0 errors
  - < 15 warnings total

---

## 📋 PHASE 4: Documentation

- [ ] Update README.md
  - Add section on multi-tenant architecture
  - Explain credential isolation
- [ ] Add diagram of webhook flow
  - Show HMAC validation per tenant
- [ ] Document SLA changes
  - Webhook latency may +10% due to extra queries
  - Mitigate with Redis caching

---

## 🚀 Final Verification

### Pre-Launch Checklist

- [ ] All tests pass: `npm run test`
  - [ ] Existing tests still pass (no regressions)
  - [ ] New tests for multi-tenant

- [ ] Security audit passed
  - [ ] No process.env tokens outside config
  - [ ] All queries filter by tenantId
  - [ ] HMAC validation mandatory in webhooks

- [ ] Performance acceptable
  - [ ] Webhook latency < 200ms
  - [ ] No N+1 queries (check with DB logs)

- [ ] Logs show tenant context
  - [ ] HMAC validation logs include tenantId
  - [ ] Service logs include tenantId

- [ ] Admin UI works
  - [ ] Admin can save credentials
  - [ ] Form masks sensitive values
  - [ ] Multiple tenants can have different creds

---

## 📊 Progress Tracker

| Phase | Component                 | % Done | Time | Notes         |
| ----- | ------------------------- | ------ | ---- | ------------- |
| ✅ 1  | webhookHmac middleware    | 100%   | 30m  | COMPLETE      |
| ✅ 1  | WebhookController.verify  | 100%   | 15m  | COMPLETE      |
| ✅ 1  | webhookRoutes integration | 100%   | 10m  | COMPLETE      |
| 🔄 2  | FlowEngine integration    | 0%     | 30m  | NEXT          |
| 2     | MediaService integration  | 0%     | 30m  | AFTER FLOW    |
| 2     | QueueService validation   | 0%     | 20m  | AFTER MEDIA   |
| 3     | Integration tests         | 0%     | 2h   | CREATE TESTS  |
| 3     | Security tests            | 0%     | 1h   | EDGE CASES    |
| 4     | Documentation             | 0%     | 30m  | README UPDATE |
| 4     | Final verification        | 0%     | 1h   | BEFORE LAUNCH |

**Total Estimated Time**: 5-6 hours remaining

---

## 📞 Support Documents

When implementing, refer to:

1. **MULTITENANT_SECURITY_AUDIT.md**
   - Problems found and solutions
   - Security matrix

2. **MULTITENANT_SERVICE_INTEGRATION.md**
   - Detailed code examples for each service
   - Before/after comparisons

3. **MULTITENANT_IMPLEMENTATION_SUMMARY.md**
   - Executive summary
   - Checklist of what was done

---

## 🎯 Definition of Done (for each phase)

### Phase 2 - FlowEngine Complete

- [ ] No process.env.WHATSAPP_TOKEN references in FlowEngine
- [ ] All message sends use config.whatsappToken
- [ ] Tests pass
- [ ] 2-tenant integration test succeeds

### Phase 2 - MediaService Complete

- [ ] No process.env tokens in MediaService
- [ ] All callers pass tenantId
- [ ] Upload/download works for 2 tenants
- [ ] Tests pass

### Phase 2 - QueueService Complete

- [ ] Validation prevents cross-tenant assignments
- [ ] All queries filter/validate tenantId
- [ ] Tests pass
- [ ] Agent cannot see other tenant's conversations

### Phase 3 - All Tests Pass

- [ ] npm run quality: 100%
- [ ] Multi-tenant integration tests: all green ✅
- [ ] Security tests: all edges covered
- [ ] Performance acceptable

### Phase 4 - Production Ready

- [ ] Documentation updated
- [ ] Team trained
- [ ] Monitoring in place
- [ ] Rollback plan documented

---

## 💡 Tips While Implementing

1. **Always filter by tenantId**
   - Every database query should have `where: { tenantId }`
   - Use Prisma's `findUnique` where possible

2. **Test with 2+ tenants**
   - Don't assume code works if you only test 1 tenant
   - Cross-tenant data leaks are silent otherwise

3. **Credentials flow**
   - Save: Admin UI → ConfigurationController → Database
   - Load: Service → prisma.configuration.findUnique() → Use
   - Never use process.env in services

4. **Error handling**
   - Missing config → 500 (safe fail)
   - Invalid HMAC → 403 (security reject)
   - Cross-tenant access → 403 (forbidden)

5. **Logging**
   - Log tenantId in every webhook event
   - Log when config is missing
   - Log HMAC validation results

---

**Last Updated**: 2026-03-04  
**Next Update**: When Phase 2 is complete
