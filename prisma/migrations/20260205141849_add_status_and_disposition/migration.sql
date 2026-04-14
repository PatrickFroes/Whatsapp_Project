-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "closingNotes" TEXT,
ADD COLUMN     "disposition" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "statusReason" TEXT;
