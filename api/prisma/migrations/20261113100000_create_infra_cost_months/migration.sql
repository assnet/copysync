-- COST-15: fechamento mensal dos custos da infraestrutura, gravado pelo InfraCostSnapshotJob no início
-- do mês seguinte (idempotente: PK por mês). Preços, cotação e método ficam congelados.
CREATE TABLE "infra_cost_months" (
    "month" DATE NOT NULL,
    "closingMethod" TEXT NOT NULL,
    "fxRate" DECIMAL(10,4),
    "fxReferenceDate" DATE,
    "fxSource" TEXT,
    "totalUsd" DECIMAL(14,4) NOT NULL,
    "totals" JSONB NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_cost_months_pkey" PRIMARY KEY ("month"),
    CONSTRAINT "infra_cost_months_closingMethod_check" CHECK ("closingMethod" IN ('last_business_day', 'month_average')),
    CONSTRAINT "infra_cost_months_fxSource_check" CHECK ("fxSource" IS NULL OR "fxSource" IN ('override', 'ptax', 'sgs'))
);

-- Tenant-aware: leitura por tenant sempre com "tenantId". Índice do cursor do mês fechado (COST-14).
CREATE TABLE "infra_cost_month_tenants" (
    "month" DATE NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planSlug" TEXT,
    "contractedAvg" DOUBLE PRECISION NOT NULL,
    "sessionHours" INTEGER NOT NULL,
    "sharedUsd" DECIMAL(14,4) NOT NULL,
    "aiUsd" DECIMAL(14,4) NOT NULL,
    "totalUsd" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "infra_cost_month_tenants_pkey" PRIMARY KEY ("month", "tenantId")
);

CREATE INDEX "infra_cost_month_tenants_month_totalUsd_tenantId_idx" ON "infra_cost_month_tenants"("month", "totalUsd" DESC, "tenantId");

ALTER TABLE "infra_cost_month_tenants" ADD CONSTRAINT "infra_cost_month_tenants_month_fkey" FOREIGN KEY ("month") REFERENCES "infra_cost_months"("month") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "infra_cost_month_tenants" ADD CONSTRAINT "infra_cost_month_tenants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
