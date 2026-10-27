-- CreateEnum
CREATE TYPE "OfferDispatchOrder" AS ENUM ('SEQUENTIAL', 'INTERLEAVED');

-- AlterTable
ALTER TABLE "offer_generator_configs"
  ADD COLUMN "dispatchOrder" "OfferDispatchOrder" NOT NULL DEFAULT 'SEQUENTIAL',
  ALTER COLUMN "intervalMinSeconds" SET DEFAULT 120,
  ALTER COLUMN "intervalMaxSeconds" SET DEFAULT 300;

-- CreateTable
CREATE TABLE "offer_generator_config_sessions" (
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "offer_generator_config_sessions_pkey" PRIMARY KEY ("tenantId","sessionId")
);

-- CreateIndex
CREATE INDEX "offer_generator_config_sessions_sessionId_idx" ON "offer_generator_config_sessions"("sessionId");

-- AddForeignKey
ALTER TABLE "offer_generator_config_sessions" ADD CONSTRAINT "offer_generator_config_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "offer_generator_configs"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_generator_config_sessions" ADD CONSTRAINT "offer_generator_config_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a sessão única já configurada vira a primeira da lista
INSERT INTO "offer_generator_config_sessions" ("tenantId", "sessionId", "position")
SELECT "tenantId", "sessionId", 0 FROM "offer_generator_configs" WHERE "sessionId" IS NOT NULL;
