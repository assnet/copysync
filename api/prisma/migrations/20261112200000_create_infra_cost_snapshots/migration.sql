-- COST-09/10: snapshots horários dos custos da infraestrutura. Retenção de 400 dias apagada em
-- lotes pelo InfraCostSnapshotJob. Sem id da Render: `resourceKey` é o papel do recurso.
CREATE TABLE "infra_resource_hours" (
    "hour" TIMESTAMP(3) NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "plan" TEXT,
    "instances" INTEGER NOT NULL,
    "instancesSource" TEXT NOT NULL,
    "diskGb" INTEGER,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_resource_hours_pkey" PRIMARY KEY ("hour", "resourceKey"),
    CONSTRAINT "infra_resource_hours_resourceKey_check" CHECK ("resourceKey" IN ('api', 'worker', 'redis', 'postgres', 'static')),
    CONSTRAINT "infra_resource_hours_instancesSource_check" CHECK ("instancesSource" IN ('samples', 'render')),
    CONSTRAINT "infra_resource_hours_instances_check" CHECK ("instances" >= 0)
);

-- Tenant-aware: leitura por tenant sempre com "tenantId". PK cobre leituras por dia.
CREATE TABLE "tenant_session_hours" (
    "day" DATE NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planSlug" TEXT,
    "connectedHours" INTEGER NOT NULL DEFAULT 0,
    "contractedSessions" INTEGER NOT NULL DEFAULT 0,
    "contractedSamples" INTEGER NOT NULL DEFAULT 0,
    "lastHour" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_session_hours_pkey" PRIMARY KEY ("day", "tenantId")
);

CREATE INDEX "tenant_session_hours_tenantId_day_idx" ON "tenant_session_hours"("tenantId", "day");

ALTER TABLE "tenant_session_hours" ADD CONSTRAINT "tenant_session_hours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "infra_fx_rates" (
    "referenceDate" DATE NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_fx_rates_pkey" PRIMARY KEY ("referenceDate"),
    CONSTRAINT "infra_fx_rates_source_check" CHECK ("source" IN ('ptax', 'sgs'))
);

CREATE TABLE "infra_usage_daily" (
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "lastHour" TIMESTAMP(3),
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_usage_daily_pkey" PRIMARY KEY ("day", "metric", "resourceKey"),
    CONSTRAINT "infra_usage_daily_metric_check" CHECK ("metric" IN ('bandwidth_gb', 'build_minutes')),
    CONSTRAINT "infra_usage_daily_source_check" CHECK ("source" IN ('render_metrics', 'render_deploys'))
);
