-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "OfferDispatchStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "AffiliateProvider" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "productRef" TEXT,
    "title" TEXT,
    "priceCents" INTEGER,
    "originalPriceCents" INTEGER,
    "imageUrl" TEXT,
    "affiliateUrl" TEXT NOT NULL,
    "attributionVerified" BOOLEAN NOT NULL DEFAULT true,
    "text" TEXT NOT NULL,
    "textEdited" BOOLEAN NOT NULL DEFAULT false,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_dispatches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "OfferDispatchStatus" NOT NULL DEFAULT 'QUEUED',
    "notBefore" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "chatMessageId" TEXT,
    "failureReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_destinations" (
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_destinations_pkey" PRIMARY KEY ("tenantId","conversationId")
);

-- CreateIndex
CREATE INDEX "offers_tenantId_createdAt_idx" ON "offers"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "offers_status_idx" ON "offers"("status");

-- CreateIndex
CREATE INDEX "offer_dispatches_status_notBefore_idx" ON "offer_dispatches"("status", "notBefore");

-- CreateIndex
CREATE INDEX "offer_dispatches_tenantId_offerId_idx" ON "offer_dispatches"("tenantId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "offer_dispatches_offerId_conversationId_key" ON "offer_dispatches"("offerId", "conversationId");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_dispatches" ADD CONSTRAINT "offer_dispatches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_dispatches" ADD CONSTRAINT "offer_dispatches_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_dispatches" ADD CONSTRAINT "offer_dispatches_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_destinations" ADD CONSTRAINT "offer_destinations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_destinations" ADD CONSTRAINT "offer_destinations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
