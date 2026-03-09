-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'WAITING', 'BOT', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'EVENT', 'STICKER');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "chat_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "contactId" TEXT NOT NULL,
    "externalChatId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "assignedUserId" TEXT,
    "queueName" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "ChatMessageDirection" NOT NULL,
    "type" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "mediaUrl" TEXT,
    "mimeType" TEXT,
    "externalMessageId" TEXT,
    "status" "ChatMessageStatus",
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_contacts_tenantId_idx" ON "chat_contacts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_contacts_tenantId_phone_key" ON "chat_contacts"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "chat_conversations_tenantId_status_idx" ON "chat_conversations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "chat_conversations_tenantId_lastMessageAt_idx" ON "chat_conversations"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_conversations_tenantId_sessionId_idx" ON "chat_conversations"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "chat_conversations_tenantId_contactId_idx" ON "chat_conversations"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "chat_messages_tenantId_conversationId_idx" ON "chat_messages"("tenantId", "conversationId");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "chat_contacts" ADD CONSTRAINT "chat_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "chat_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
