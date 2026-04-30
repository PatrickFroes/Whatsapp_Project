-- Migration: Unify credential management - move all to Configuration table
-- Remove deprecated fields from Tenant, add constraints to Configuration

-- Step 1: Add UNIQUE index on phoneNumberId before adding NOT NULL constraint
-- This allows the migration to succeed even if there are duplicate values initially
CREATE UNIQUE INDEX "Configuration_phoneNumberId_key" ON "Configuration"("phoneNumberId") WHERE "phoneNumberId" IS NOT NULL;

-- Step 2: Set NOT NULL constraints on Configuration fields
-- These fields must be set before the migration if not already set
ALTER TABLE "Configuration" ALTER COLUMN "phoneNumberId" SET NOT NULL;
ALTER TABLE "Configuration" ALTER COLUMN "whatsappToken" SET NOT NULL;
ALTER TABLE "Configuration" ALTER COLUMN "metaAppSecret" SET NOT NULL;
ALTER TABLE "Configuration" ALTER COLUMN "verifyToken" SET NOT NULL;

-- Step 3: Remove deprecated fields from Tenant table
ALTER TABLE "Tenant" DROP COLUMN "waPhoneId";
ALTER TABLE "Tenant" DROP COLUMN "waBusinessId";
ALTER TABLE "Tenant" DROP COLUMN "waAccessToken";
