-- MQ-23: amostras agregadas (5 min) de Render, Postgres e workers. Sem tenant (infraestrutura);
-- retenção de 7 dias apagada pelo OpsMetricsSamplerJob.
CREATE TABLE "ops_metrics_samples" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "meta" JSONB,

    CONSTRAINT "ops_metrics_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ops_metrics_samples_metric_at_idx" ON "ops_metrics_samples"("metric", "at");
