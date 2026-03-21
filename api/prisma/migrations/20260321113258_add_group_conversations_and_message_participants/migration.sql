-- DropForeignKey
ALTER TABLE "chat_conversations" DROP CONSTRAINT "chat_conversations_contactId_fkey";

-- AlterTable
ALTER TABLE "chat_conversations" ADD COLUMN     "groupJid" TEXT,
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "contactId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "fromParticipant" TEXT,
ADD COLUMN     "fromParticipantName" TEXT;

-- CreateIndex
CREATE INDEX "chat_conversations_tenantId_groupJid_idx" ON "chat_conversations"("tenantId", "groupJid");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "chat_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
