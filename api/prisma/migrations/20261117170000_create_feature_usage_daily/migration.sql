-- Uso dos recursos, P2 (design §4.3): agregado diário por dia (Brasília) × conta × recurso × tipo.
-- Aditiva: só tabela nova. `updatedAt` sem DEFAULT (como o `@updatedAt` do Prisma): SQL cru grava a coluna.

-- CreateTable
CREATE TABLE "feature_usage_daily" (
    "day" DATE NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uses" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_usage_daily_pkey" PRIMARY KEY ("day","tenantId","featureKey","kind")
);

-- CreateIndex
CREATE INDEX "feature_usage_daily_featureKey_day_idx" ON "feature_usage_daily"("featureKey", "day");

-- AddForeignKey
ALTER TABLE "feature_usage_daily" ADD CONSTRAINT "feature_usage_daily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
