-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "flows" JSONB,
ADD COLUMN     "pauseReasons" JSONB;
