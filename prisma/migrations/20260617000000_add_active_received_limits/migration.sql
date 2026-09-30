-- AlterTable
ALTER TABLE "User" ADD COLUMN     "maxActiveChats" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "maxReceivedChats" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "initiationType" TEXT NOT NULL DEFAULT 'INBOUND';
