-- AlterTable: dono da sessão (lease) e pedido de conexão (docs/arquitetura-escala.md §3.1)
ALTER TABLE "sessions"
  ADD COLUMN "ownerWorkerId" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "connectRequestedAt" TIMESTAMP(3),
  ADD COLUMN "nextAdoptAt" TIMESTAMP(3),
  ADD COLUMN "adoptFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shard" TEXT;

-- CreateIndex
CREATE INDEX "sessions_ownerWorkerId_idx" ON "sessions"("ownerWorkerId");
CREATE INDEX "sessions_connectRequestedAt_idx" ON "sessions"("connectRequestedAt");

-- Backfill (D3): sessões já conectadas contam como pedido de conexão, para a E4 readotá-las.
-- Coluna `timestamp` sem fuso gravada em UTC (padrão do Prisma): `now()` convertido, nunca no fuso da sessão.
UPDATE "sessions" SET "connectRequestedAt" = (now() AT TIME ZONE 'UTC') WHERE "status" = 'CONNECTED' AND "deletedAt" IS NULL;
