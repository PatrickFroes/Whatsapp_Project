# 🚨 CRITICAL ARCHITECTURE ISSUE: MULTI-PHONE NUMBER SUPPORT

**Date:** 2026-04-29  
**Status:** 🔴 ARCHITECTURAL REDESIGN NEEDED

---

## 📋 CURRENT ARCHITECTURE (BROKEN FOR MULTI-PHONE)

```
Tenant (1)
├── waPhoneId: "1234567890"
├── waBusinessId: "98765432"
├── Configuration (1:1)
│   ├── phoneNumberId: "1234567890"
│   ├── verifyToken: "token123"
│   ├── whatsappToken: "token_xyz"
│   └── metaAppSecret: "secret_abc"
└── Users, Conversations, Contacts

❌ PROBLEM:
- Only 1 phone number per tenant
- Webhook routes by waPhoneId
- If tenant adds 2nd number, system breaks
- No way to manage multiple channels
```

---

## ✅ REQUIRED ARCHITECTURE (MULTI-PHONE SUPPORT)

```
Tenant (1)
├── name: "Company ABC"
├── slug: "company-abc"
└── PhoneNumbers (Many)
    │
    ├─ PhoneNumber #1
    │  ├── id: "pn_001"
    │  ├── tenantId: "tenant_1"
    │  ├── phoneNumberId: "1234567890"
    │  ├── displayName: "Sales"
    │  ├── isActive: true
    │  ├── verifyToken: "token_123"
    │  ├── whatsappToken: "token_xyz"
    │  ├── metaAppSecret: "secret_abc"
    │  ├── createdAt, updatedAt
    │  └── Conversations, Contacts (filtered by phoneNumberId)
    │
    ├─ PhoneNumber #2
    │  ├── id: "pn_002"
    │  ├── tenantId: "tenant_1"
    │  ├── phoneNumberId: "9876543210"
    │  ├── displayName: "Support"
    │  ├── isActive: true
    │  ├── verifyToken: "token_456"
    │  ├── whatsappToken: "token_abc"
    │  ├── metaAppSecret: "secret_def"
    │  ├── createdAt, updatedAt
    │  └── Conversations, Contacts (filtered by phoneNumberId)
    │
    └─ PhoneNumber #3
       ├── id: "pn_003"
       ├── tenantId: "tenant_1"
       ├── phoneNumberId: "5555555555"
       ├── displayName: "Marketing"
       ├── isActive: false (disabled)
       └── ...

✅ BENEFITS:
- Multiple channels per tenant
- Separate credentials per number
- Independent conversation routing
- Per-number performance tracking
- Flexible team assignment by number
```

---

## 🔴 CURRENT ISSUES BY LAYER

### Database Schema Level
```prisma
# CURRENT (WRONG)
model Tenant {
  id              String
  waPhoneId       String?         # ❌ Only one number
  waBusinessId    String?
  waAccessToken   String?
}

model Configuration {
  id              String    @id
  tenantId        String    @unique    # ❌ 1:1 relation
  phoneNumberId   String?
  verifyToken     String?
  whatsappToken   String?
  metaAppSecret   String?
}

# REQUIRED (CORRECT)
model Tenant {
  id              String
  name            String
  slug            String    @unique
  # Remove: waPhoneId, waBusinessId, waAccessToken
  phoneNumbers    PhoneNumber[]
}

model PhoneNumber {
  id              String    @id @default(uuid())
  tenantId        String
  phoneNumberId   String    # Meta's phone number ID
  displayName     String    # e.g., "Sales", "Support"
  businessId      String?   # Meta's business ID
  isActive        Boolean   @default(true)
  
  # Credentials per number
  verifyToken     String?
  whatsappToken   String?
  metaAppSecret   String?
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  createdBy       String?
  updatedBy       String?
  
  tenant          Tenant    @relation(fields: [tenantId], references: [id])
  conversations   Conversation[]
  contacts        Contact[]
  messages        Message[]
  
  @@unique([tenantId, phoneNumberId])
  @@index([tenantId])
  @@index([phoneNumberId])
}

model Conversation {
  # Current fields
  id              String
  contactId       String
  tenantId        String
  
  # ADD: phoneNumberId
  phoneNumberId   String    # ✅ Reference to PhoneNumber
  
  status          String    # BOT, QUEUED, ASSIGNED, RESOLVED, CLOSED
  createdAt       DateTime
  
  contact         Contact   @relation(fields: [contactId], references: [id])
  phoneNumber     PhoneNumber @relation(fields: [phoneNumberId], references: [id])
  tenant          Tenant    @relation(fields: [tenantId], references: [id])
  
  @@unique([tenantId, contactId, phoneNumberId])  # ✅ Unique per tenant+contact+phone
  @@index([tenantId, phoneNumberId])
}

model Contact {
  # Current fields
  id              String
  tenantId        String
  phone           String
  name            String
  
  # ADD: phoneNumberIds (which channels are this contact on?)
  phoneNumbers    PhoneNumber[]  # Many-to-many
  
  # OR structure by number:
  # phoneNumberId   String    # Primary channel
  
  @@unique([tenantId, phone])
}

model Message {
  id              String
  conversationId  String
  
  # ADD: phoneNumberId
  phoneNumberId   String    # ✅ Reference to PhoneNumber
  
  content         String
  direction       String    # INBOUND, OUTBOUND
  status          String    # SENT, DELIVERED, READ, FAILED
  
  conversation    Conversation @relation(fields: [conversationId], references: [id])
  phoneNumber     PhoneNumber   @relation(fields: [phoneNumberId], references: [id])
  
  @@index([phoneNumberId])
}
```

---

## 📊 IMPACT ANALYSIS: WHAT BREAKS

### 🔴 Webhook Routing (CRITICAL)
```javascript
// CURRENT (only works for 1 number)
async function validateWebhookHmac(req, res, next) {
  const waPhoneId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  
  // ❌ This query returns only ONE configuration
  const tenant = await prisma.tenant.findFirst({
    where: { waPhoneId: waPhoneId }  // Can only have 1
  });
  
  // ❌ Breaks if tenant has 2nd number:
  // - First request: waPhoneId="111" → finds tenant
  // - Second request: waPhoneId="222" → findFirst returns nothing (not in tenant.waPhoneId)
}

// REQUIRED (multi-number support)
async function validateWebhookHmac(req, res, next) {
  const waPhoneId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  
  // ✅ Find the specific PhoneNumber record
  const phoneNumber = await prisma.phoneNumber.findUnique({
    where: { phoneNumberId: waPhoneId },  // Direct lookup, any tenant
    include: { tenant: true }
  });
  
  // ✅ Cross-check: webhook payload tenantId must match
  // (Meta sends this for multi-account setups)
  
  // ✅ Load per-number configuration
  const metaAppSecret = phoneNumber.metaAppSecret;
  
  // ✅ Inject both tenant and phoneNumber into request
  req.tenant = phoneNumber.tenant;
  req.phoneNumber = phoneNumber;
}
```

### 🔴 Message Sending (CRITICAL)
```javascript
// CURRENT (assumes 1 number per tenant)
async sendMessage(to, content, tenant) {
  // ❌ Loads only 1 configuration
  const config = await prisma.configuration.findUnique({
    where: { tenantId: tenant.id }
  });
  
  // ❌ If tenant has 2 numbers, which one to use?
  // - Assumes all messages go to 1st number
  // - Can't route to specific number
}

// REQUIRED (multi-number support)
async sendMessage(to, content, tenant, phoneNumberId) {
  // ✅ Load specific PhoneNumber
  const phoneNumber = await prisma.phoneNumber.findFirst({
    where: {
      tenantId: tenant.id,
      phoneNumberId: phoneNumberId
    }
  });
  
  // ✅ Send from specific number
  const response = await axios.post(
    `https://graph.facebook.com/v23.0/${phoneNumber.phoneNumberId}/messages`,
    { ... },
    { headers: { Authorization: `Bearer ${phoneNumber.whatsappToken}` } }
  );
}
```

### 🔴 Conversation Routing (CRITICAL)
```javascript
// CURRENT (no phone number context)
async processWebhookMessage(tenant, message) {
  // ❌ Creates conversation with no reference to which number
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      contactId: contact.id,
      status: 'BOT'
      // ❌ Missing: phoneNumberId
    }
  });
  
  // ❌ Later, when sending reply, don't know which number to use!
}

// REQUIRED (phone number context)
async processWebhookMessage(tenant, phoneNumber, message) {
  // ✅ Create conversation with phone number reference
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      phoneNumberId: phoneNumber.id,    // ✅ Which number?
      contactId: contact.id,
      status: 'BOT'
    }
  });
  
  // ✅ When replying, use correct number
  const phoneNumber = await prisma.phoneNumber.findUnique({
    where: { id: conversation.phoneNumberId }
  });
  await whatsappService.sendMessage(to, content, tenant, phoneNumber.phoneNumberId);
}
```

### 🔴 Admin UI (SIGNIFICANT CHANGES)

```javascript
// CURRENT
GET /api/admin/settings
Response: {
  waPhoneId: "1234567890",
  waBusinessId: "9876543",
  meta: { phone_number_id: "1234567890" }
}

PUT /api/admin/settings
Body: {
  waPhoneId: "1234567890",  // ❌ Can only update one
  waBusinessId: "9876543"
}

// REQUIRED
GET /api/admin/settings
Response: {
  phoneNumbers: [
    {
      id: "pn_001",
      phoneNumberId: "1234567890",
      displayName: "Sales",
      isActive: true,
      businessId: "9876543",
      configured: true,
      createdAt, updatedAt
    },
    {
      id: "pn_002",
      phoneNumberId: "9876543210",
      displayName: "Support",
      isActive: true,
      businessId: "9876543",
      configured: true,
      createdAt, updatedAt
    }
  ]
}

GET /api/admin/phoneNumbers/:id
Response: {
  id: "pn_001",
  phoneNumberId: "1234567890",
  displayName: "Sales",
  isActive: true,
  businessId: "9876543",
  isConfigured: { verifyToken: true, whatsappToken: true, metaAppSecret: true },
  updatedAt
}

POST /api/admin/phoneNumbers
Body: {
  phoneNumberId: "1234567890",  // ✅ Meta's number ID
  displayName: "Sales Team",
  verifyToken: "verify_token_123",
  whatsappToken: "eaa...",
  metaAppSecret: "secret123"
}

PUT /api/admin/phoneNumbers/:id
Body: {
  displayName: "Sales Team Updated",
  isActive: true,
  whatsappToken: "eaa...",  // Can update credentials
  metaAppSecret: "secret123"
}

DELETE /api/admin/phoneNumbers/:id
Response: 204 No Content
# Removes number and its conversations/messages history (or soft delete?)
```

---

## 🎯 MIGRATION STRATEGY

### Phase 1: Add PhoneNumber Table (Database)
```sql
CREATE TABLE "PhoneNumber" (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL REFERENCES "Tenant"(id),
  phoneNumberId   TEXT NOT NULL,
  displayName     TEXT NOT NULL,
  businessId      TEXT,
  isActive        BOOLEAN DEFAULT true,
  
  verifyToken     TEXT,
  whatsappToken   TEXT,
  metaAppSecret   TEXT,
  
  createdAt       TIMESTAMP DEFAULT NOW(),
  updatedAt       TIMESTAMP DEFAULT NOW(),
  createdBy       TEXT,
  updatedBy       TEXT,
  
  UNIQUE(tenantId, phoneNumberId),
  INDEX idx_tenantId(tenantId),
  INDEX idx_phoneNumberId(phoneNumberId)
);

-- Update Conversation to reference PhoneNumber
ALTER TABLE "Conversation" 
ADD COLUMN phoneNumberId TEXT REFERENCES "PhoneNumber"(id);

-- Update Message to reference PhoneNumber
ALTER TABLE "Message" 
ADD COLUMN phoneNumberId TEXT REFERENCES "PhoneNumber"(id);
```

### Phase 2: Migrate Existing Data
```sql
-- For each Configuration record, create PhoneNumber
INSERT INTO "PhoneNumber" (id, tenantId, phoneNumberId, displayName, businessId, verifyToken, whatsappToken, metaAppSecret, createdAt, updatedAt, createdBy, updatedBy)
SELECT 
  uuid(),
  tenantId,
  phoneNumberId,
  'Default',                    -- displayName
  (SELECT waBusinessId FROM "Tenant" WHERE "Tenant".id = "Configuration".tenantId),  -- businessId
  verifyToken,
  whatsappToken,
  metaAppSecret,
  createdAt,
  updatedAt,
  updatedBy,
  updatedBy
FROM "Configuration"
WHERE phoneNumberId IS NOT NULL;

-- Update Conversations to reference PhoneNumber
UPDATE "Conversation" c
SET phoneNumberId = (
  SELECT id FROM "PhoneNumber" 
  WHERE "PhoneNumber".tenantId = c.tenantId 
  LIMIT 1  -- Pick the first number for each tenant
)
WHERE phoneNumberId IS NULL;
```

### Phase 3: Update Application Code
- [ ] Update webhookHmac.middleware.js to use PhoneNumber lookup
- [ ] Update whatsapp.js to accept phoneNumberId parameter
- [ ] Update ChatController to pass phoneNumberId
- [ ] Update WebhookController to inject phoneNumber
- [ ] Update FlowEngine to use correct phone number
- [ ] Update AdminController to manage multiple numbers
- [ ] Create new PhoneNumberController for CRUD operations
- [ ] Update routes to handle phone number management

### Phase 4: Update Admin UI
- Replace single "Configure Phone Number" with "Manage Phone Numbers"
- Add "Add Phone Number" button
- Show list of all numbers with their status
- Allow enabling/disabling specific numbers
- Show separate credentials for each number

### Phase 5: Remove Old Fields
```sql
ALTER TABLE "Tenant" DROP COLUMN waPhoneId;
ALTER TABLE "Tenant" DROP COLUMN waBusinessId;
ALTER TABLE "Tenant" DROP COLUMN waAccessToken;
DROP TABLE "Configuration";
```

---

## 📝 REQUIRED SCHEMA CHANGES

### Zod Schemas Needed

```javascript
// PhoneNumber validation
const CreatePhoneNumberSchema = z.object({
  phoneNumberId: z.string()
    .regex(/^\d+$/, 'Phone Number ID must be numeric'),
  displayName: z.string()
    .min(1, 'Display name required')
    .max(50, 'Max 50 characters'),
  businessId: z.string().optional(),
  verifyToken: z.string().min(8, 'Verify token required'),
  whatsappToken: z.string().min(20, 'WhatsApp token required'),
  metaAppSecret: z.string().min(20, 'Meta app secret required')
});

const UpdatePhoneNumberSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  verifyToken: z.string().min(8).optional(),
  whatsappToken: z.string().min(20).optional(),
  metaAppSecret: z.string().min(20).optional()
});
```

---

## 🚨 CRITICAL DECISIONS NEEDED

1. **Contact Ownership:** 
   - Should a contact be associated with ONE phone number or MULTIPLE?
   - Current: `Contact { tenantId, phone }` - unique per tenant
   - Option A: Add `phoneNumberId` - unique per tenant+phone+number
   - Option B: Many-to-many - contact can have conversations on multiple numbers

2. **Conversation Routing:**
   - Should conversations be unique by tenant+phone+number?
   - Or should we create new conversation for same contact on different number?

3. **Data Retention:**
   - When deleting a phone number, what happens to its conversations/messages?
   - Option A: Hard delete (loss of history)
   - Option B: Soft delete (keep history, mark as inactive)
   - Option C: Archive (export history before deletion)

4. **Backward Compatibility:**
   - Should old API still work (assumes 1 number)?
   - Or force all clients to upgrade?

5. **Migration Timeline:**
   - Is this breaking change acceptable?
   - Can be done in one deployment or needs gradual migration?

---

## 📊 SCOPE & EFFORT ESTIMATE

| Component | Effort | Risk | Complexity |
|-----------|--------|------|-----------|
| Database Migration | Medium | HIGH | High |
| webhookHmac.middleware.js | Low | MEDIUM | Medium |
| whatsapp.js service | Low | LOW | Low |
| ChatController | Medium | MEDIUM | Medium |
| WebhookController | Low | LOW | Low |
| FlowEngine | Low | LOW | Low |
| AdminController | High | MEDIUM | High |
| PhoneNumberController (NEW) | High | MEDIUM | High |
| Admin UI | High | LOW | Medium |
| Data Migration | Medium | HIGH | High |
| Testing | High | HIGH | High |

**Total Effort:** 8-12 developer days (depends on team expertise)

---

## ✅ RECOMMENDATION

**This is a critical architectural gap that MUST be addressed before production if multi-phone scenarios are needed.**

1. **If only 1 phone number per tenant:**
   - Keep current architecture
   - Rename `Configuration` → `PhoneNumberConfig` for clarity
   - Document: "Each tenant supports exactly 1 WhatsApp number"

2. **If multiple numbers needed (recommended):**
   - Implement PhoneNumber table
   - Update all layers as described
   - Timeline: 1-2 sprints
   - Breaking change: requires customer communication

3. **Short-term workaround:**
   - Create multiple Tenants for same company (bad UX)
   - Each "tenant" = one phone number
   - Share users across tenants (admin complex)

---

**Current Status:** 🔴 **ARCHITECTURAL GAP IDENTIFIED - REQUIRES DESIGN DECISION**

This is foundational work that affects the entire application. Should be addressed early, not retrofitted later.
