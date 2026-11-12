-- Caçador de ofertas (Shein): caçadas, execuções, achados e destino por tenant.
-- Excluir a caçada não apaga execuções/achados (huntId = NULL): teto diário e guarda de 24/dia seguem valendo.

-- CreateEnum
CREATE TYPE "OfferHuntStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "OfferHuntPauseReason" AS ENUM ('USER', 'SOURCE_UNAVAILABLE', 'CREDENTIAL_REJECTED', 'RISK_NOT_ACCEPTED', 'PLAN_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "OfferHuntDeliveryMode" AS ENUM ('REVIEW', 'AUTO');

-- CreateEnum
CREATE TYPE "OfferHuntRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OfferHuntRunTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "OfferHuntFindStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'DISMISSED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "offer_hunts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OfferHuntStatus" NOT NULL DEFAULT 'ACTIVE',
    "pauseReason" "OfferHuntPauseReason",
    "sort" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "commissionBand" INTEGER,
    "keyword" TEXT,
    "minPriceCents" INTEGER,
    "maxPriceCents" INTEGER,
    "minDiscountPercent" INTEGER,
    "minCommissionPercent" DECIMAL(5,2),
    "minCommissionCents" INTEGER,
    "minRating" DECIMAL(3,2),
    "minSalesBucket" INTEGER,
    "minReviewsBucket" INTEGER,
    "extraCommissionOnly" BOOLEAN NOT NULL DEFAULT false,
    "endsWithinDays" INTEGER,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "topN" INTEGER NOT NULL DEFAULT 3,
    "repeatAfterDays" INTEGER NOT NULL DEFAULT 7,
    "deliveryMode" "OfferHuntDeliveryMode" NOT NULL DEFAULT 'REVIEW',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "windowStartMinute" INTEGER NOT NULL DEFAULT 0,
    "windowEndMinute" INTEGER NOT NULL DEFAULT 1440,
    "weekdaysMask" INTEGER NOT NULL DEFAULT 127,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "claimedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_hunts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_hunt_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "huntId" TEXT,
    "trigger" "OfferHuntRunTrigger" NOT NULL,
    "status" "OfferHuntRunStatus" NOT NULL DEFAULT 'RUNNING',
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "chosenCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "aiFallback" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "offer_hunt_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_hunt_finds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "huntId" TEXT,
    "runId" TEXT,
    "goodsId" TEXT NOT NULL,
    "skcCode" TEXT,
    "activityId" TEXT,
    "title" TEXT NOT NULL,
    "priceCents" INTEGER,
    "originalPriceCents" INTEGER,
    "discountPercent" INTEGER,
    "commissionPercent" DECIMAL(5,2),
    "commissionCents" INTEGER,
    "returningCommissionPercent" DECIMAL(5,2),
    "returningCommissionCents" INTEGER,
    "extraCommissionCents" INTEGER,
    "salesBucket" INTEGER,
    "reviewsBucket" INTEGER,
    "rating" DECIMAL(3,2),
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "aiReason" TEXT,
    "status" "OfferHuntFindStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "failureReason" TEXT,
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_hunt_finds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_hunter_settings" (
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_hunter_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "offer_hunts_status_nextRunAt_idx" ON "offer_hunts"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "offer_hunts_tenantId_createdAt_idx" ON "offer_hunts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "offer_hunt_runs_tenantId_startedAt_idx" ON "offer_hunt_runs"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "offer_hunt_runs_huntId_startedAt_idx" ON "offer_hunt_runs"("huntId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "offer_hunt_finds_huntId_goodsId_createdAt_idx" ON "offer_hunt_finds"("huntId", "goodsId", "createdAt");

-- CreateIndex
CREATE INDEX "offer_hunt_finds_tenantId_createdAt_idx" ON "offer_hunt_finds"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "offer_hunt_finds_tenantId_status_idx" ON "offer_hunt_finds"("tenantId", "status");

-- CreateIndex
CREATE INDEX "offer_hunt_finds_runId_idx" ON "offer_hunt_finds"("runId");

-- CreateIndex
CREATE INDEX "offer_hunt_finds_offerId_idx" ON "offer_hunt_finds"("offerId");

-- CreateIndex
CREATE INDEX "offer_hunter_settings_sessionId_idx" ON "offer_hunter_settings"("sessionId");

-- CreateIndex
CREATE INDEX "offer_hunter_settings_conversationId_idx" ON "offer_hunter_settings"("conversationId");

-- AddForeignKey
ALTER TABLE "offer_hunts" ADD CONSTRAINT "offer_hunts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunt_runs" ADD CONSTRAINT "offer_hunt_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunt_runs" ADD CONSTRAINT "offer_hunt_runs_huntId_fkey" FOREIGN KEY ("huntId") REFERENCES "offer_hunts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunt_finds" ADD CONSTRAINT "offer_hunt_finds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunt_finds" ADD CONSTRAINT "offer_hunt_finds_huntId_fkey" FOREIGN KEY ("huntId") REFERENCES "offer_hunts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunt_finds" ADD CONSTRAINT "offer_hunt_finds_runId_fkey" FOREIGN KEY ("runId") REFERENCES "offer_hunt_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunt_finds" ADD CONSTRAINT "offer_hunt_finds_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunter_settings" ADD CONSTRAINT "offer_hunter_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunter_settings" ADD CONSTRAINT "offer_hunter_settings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_hunter_settings" ADD CONSTRAINT "offer_hunter_settings_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

