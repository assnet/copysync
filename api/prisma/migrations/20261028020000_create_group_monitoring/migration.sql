-- Monitoramento de grupos (docs/monitoramento-grupos.md). Aditiva: tabelas novas + offers.sourceKey (nullable, único).

-- CreateEnum
CREATE TYPE "CapturedOfferStatus" AS ENUM ('PENDING', 'PROCESSING', 'QUEUED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "sourceKey" TEXT;

-- CreateTable
CREATE TABLE "group_monitor_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "windowStartMinute" INTEGER NOT NULL DEFAULT 0,
    "windowEndMinute" INTEGER NOT NULL DEFAULT 1440,
    "intervalMinSeconds" INTEGER NOT NULL DEFAULT 120,
    "intervalMaxSeconds" INTEGER NOT NULL DEFAULT 300,
    "startDelaySeconds" INTEGER NOT NULL DEFAULT 0,
    "maxOfferAgeMinutes" INTEGER NOT NULL DEFAULT 180,
    "couponMaxAgeMinutes" INTEGER NOT NULL DEFAULT 60,
    "mentionAll" BOOLEAN NOT NULL DEFAULT false,
    "simulateTyping" BOOLEAN NOT NULL DEFAULT false,
    "typingSeconds" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_monitor_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "keywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captured_offers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "monitoredGroupId" TEXT,
    "sourceExternalMessageId" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "sourceMediaUrl" TEXT,
    "imageUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "marketplace" "AffiliateProvider",
    "sourceUrl" TEXT,
    "affiliateUrl" TEXT,
    "coupon" TEXT,
    "finalText" TEXT,
    "status" "CapturedOfferStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "offerId" TEXT,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "captured_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_monitor_configs_sessionId_idx" ON "group_monitor_configs"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "group_monitor_configs_tenantId_sessionId_key" ON "group_monitor_configs"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "monitored_groups_sessionId_groupJid_idx" ON "monitored_groups"("sessionId", "groupJid");

-- CreateIndex
CREATE INDEX "monitored_groups_tenantId_idx" ON "monitored_groups"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_groups_tenantId_sessionId_groupJid_key" ON "monitored_groups"("tenantId", "sessionId", "groupJid");

-- CreateIndex
CREATE INDEX "broadcast_groups_tenantId_idx" ON "broadcast_groups"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_groups_tenantId_sessionId_conversationId_key" ON "broadcast_groups"("tenantId", "sessionId", "conversationId");

-- CreateIndex
CREATE INDEX "captured_offers_status_capturedAt_idx" ON "captured_offers"("status", "capturedAt");

-- CreateIndex
CREATE INDEX "captured_offers_tenantId_sessionId_capturedAt_idx" ON "captured_offers"("tenantId", "sessionId", "capturedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "captured_offers_sessionId_sourceExternalMessageId_key" ON "captured_offers"("sessionId", "sourceExternalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "offers_sourceKey_key" ON "offers"("sourceKey");

-- AddForeignKey
ALTER TABLE "group_monitor_configs" ADD CONSTRAINT "group_monitor_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_monitor_configs" ADD CONSTRAINT "group_monitor_configs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_groups" ADD CONSTRAINT "monitored_groups_configId_fkey" FOREIGN KEY ("configId") REFERENCES "group_monitor_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_groups" ADD CONSTRAINT "monitored_groups_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_groups" ADD CONSTRAINT "broadcast_groups_configId_fkey" FOREIGN KEY ("configId") REFERENCES "group_monitor_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_groups" ADD CONSTRAINT "broadcast_groups_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captured_offers" ADD CONSTRAINT "captured_offers_configId_fkey" FOREIGN KEY ("configId") REFERENCES "group_monitor_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captured_offers" ADD CONSTRAINT "captured_offers_monitoredGroupId_fkey" FOREIGN KEY ("monitoredGroupId") REFERENCES "monitored_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

