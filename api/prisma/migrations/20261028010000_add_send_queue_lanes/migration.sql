-- Fila de envio por sessão (docs/fila-de-envio.md).

-- CreateEnum
CREATE TYPE "OfferOrigin" AS ENUM ('GENERATOR', 'MONITORING');

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "origin" "OfferOrigin" NOT NULL DEFAULT 'GENERATOR';

-- AlterTable
ALTER TABLE "offer_dispatches" ADD COLUMN     "gapSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sessionId" TEXT;

-- Backfill: envios já na fila ganham a sessão da conversa e seguem de onde pararam
UPDATE "offer_dispatches" d
   SET "sessionId" = c."sessionId"
  FROM "chat_conversations" c
 WHERE c."id" = d."conversationId" AND d."sessionId" IS NULL;

-- CreateIndex
CREATE INDEX "offer_dispatches_sessionId_status_idx" ON "offer_dispatches"("sessionId", "status");

-- CreateIndex
CREATE INDEX "offer_dispatches_tenantId_updatedAt_idx" ON "offer_dispatches"("tenantId", "updatedAt");
