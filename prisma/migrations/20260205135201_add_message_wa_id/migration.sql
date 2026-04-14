/*
  Warnings:

  - A unique constraint covering the columns `[waId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "waId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_waId_key" ON "Message"("waId");
