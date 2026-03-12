-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChatMessageType" ADD VALUE 'VIDEO';
ALTER TYPE "ChatMessageType" ADD VALUE 'LOCATION';
ALTER TYPE "ChatMessageType" ADD VALUE 'VCARD';
ALTER TYPE "ChatMessageType" ADD VALUE 'CALL_LOG';

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quotedMessageId" TEXT;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_quotedMessageId_fkey" FOREIGN KEY ("quotedMessageId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
